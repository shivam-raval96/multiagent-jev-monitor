import { TypeSafeClient } from '@typesafe-ai/sdk';
import { getMode } from './policy.js';
import { selectModel } from './models.js';
import { createTokenMonitor, tokenQuestions, parseTokenAnswers } from './token-monitor.js';
import { readSSE } from './sse.js';

const system = 'You are a helpful conversational assistant. Answer clearly and accurately. Follow appropriate safety boundaries.';
export async function runChat({ env, messages, emit, abort, mode = 'safety', model }) {
  const { name } = getMode(mode);
  model = selectModel(model);
  const client = new TypeSafeClient({ apiKey: env.TYPESAFE_API_KEY, baseURL: env.TYPESAFE_BASE_URL, timeout: 10000 });
    const monitor = createTokenMonitor({
      emit, signal: abort.signal,
      evaluate: async ({ response, tokens, complete }) => {
        try {
          const result = await client.systemOne({ model: env.TYPESAFE_MODEL || 'jev-latest', state: { conversation: messages, response, tokens, complete }, questions: tokenQuestions(tokens, mode) }, { signal: abort.signal });
          return { tokens: parseTokenAnswers(result, tokens, mode), mode, model: result.model, usage: result.usage };
        } catch (e) { throw new Error(`${name} evaluation unavailable${e.status ? ` (HTTP ${e.status})` : ''}. This snapshot is unassessed.`); }
      },
    });
    let text = '';
    try {
      const upstream = await fetch(`${(env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, '')}/chat/completions`, {
        method: 'POST', signal: abort.signal,
        headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, ...messages], stream: true, max_tokens: 512, ...(model.startsWith('qwen/') || model.startsWith('openai/') ? { reasoning: { enabled: false } } : {}) }),
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
      emit('status', { message: 'Scoring remaining tokens…' });
      await monitor.finish(true);
      emit('done', {});
    } catch (e) {
      emit('error', { message: abort.signal.aborted ? 'Request stopped or timed out. Remaining text is unassessed.' : e.message });
      if (!abort.signal.aborted && text) await monitor.finish(false);
    } finally {
      monitor.cancel(); abort.abort();
    }
}
