import { TypeSafeClient } from '@typesafe-ai/sdk';
import { questions, parseAnswers } from './policy.js';
import { createMonitor } from './monitor.js';
import { readSSE } from './sse.js';

const system = 'You are a helpful conversational assistant. Answer clearly and accurately. Follow appropriate safety boundaries.';
export async function runChat({ env, messages, emit, abort }) {
  const client = new TypeSafeClient({ apiKey: env.TYPESAFE_API_KEY, baseURL: env.TYPESAFE_BASE_URL, timeout: 10000 });
    const monitor = createMonitor({
      emit,
      evaluate: async (response, complete) => {
        try {
          const result = await client.systemOne({ model: env.TYPESAFE_MODEL || 'jev-latest', state: { conversation: messages, response, complete }, questions }, { signal: abort.signal });
          return { probabilities: parseAnswers(result), model: result.model, usage: result.usage };
        } catch (e) { throw new Error(`Safety evaluation unavailable${e.status ? ` (HTTP ${e.status})` : ''}. This snapshot is unassessed.`); }
      },
    });
    let text = '';
    try {
      const upstream = await fetch(`${(env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')}/chat/completions`, {
        method: 'POST', signal: abort.signal,
        headers: { Authorization: `Bearer ${env.LLM_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: env.LLM_MODEL, messages: [{ role: 'system', content: system }, ...messages], stream: true, max_completion_tokens: 1500 }),
      });
      if (!upstream.ok) throw new Error(`LLM request failed (HTTP ${upstream.status}). Check your key, model, and endpoint.`);
      let ended = false;
      for await (const data of readSSE(upstream.body)) {
        if (data === '[DONE]') { ended = true; break; }
        const chunk = JSON.parse(data);
        if (chunk.error) throw new Error('The LLM provider reported a streaming error.');
        const choice = chunk.choices?.[0];
        const delta = choice?.delta?.content || choice?.delta?.refusal;
        if (typeof delta === 'string') {
          text += delta;
          if (text.length > 16000) throw new Error('Response length limit reached.');
          emit('token', { text: delta });
          monitor.update(text);
        }
        if (choice?.finish_reason) emit('generation-end', { reason: choice.finish_reason });
      }
      if (!ended) throw new Error('The LLM stream disconnected before completion.');
      if (!text) throw new Error('The model returned no text.');
      emit('status', { message: 'Checking final response…' });
      await monitor.finish(true);
      emit('done', {});
    } catch (e) {
      emit('error', { message: abort.signal.aborted ? 'Request stopped or timed out. Remaining text is unassessed.' : e.message });
      if (!abort.signal.aborted && text) await monitor.finish(false);
    } finally {
      monitor.cancel(); abort.abort();
    }
}
