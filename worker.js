import assets from 'site-assets';
import { dimensions, publicModes, getMode } from './lib/policy.js';
import { runChat } from './lib/chat.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const json = (status, data) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
    if (request.headers.get('origin') && request.headers.get('origin') !== url.origin) return json(403, { error: 'Same-origin requests only.' });
    const missing = ['TYPESAFE_API_KEY', 'LLM_API_KEY', 'LLM_MODEL'].filter(key => !env[key]);
    if (request.method === 'GET' && url.pathname === '/api/config') return json(200, { missing, model: env.LLM_MODEL || 'Model not configured', evaluator: env.TYPESAFE_MODEL || 'jev-latest', dimensions, modes: publicModes });
    if (request.method === 'GET' && assets[url.pathname]) {
      const asset = assets[url.pathname];
      return new Response(asset.body, { headers: { 'Content-Type': asset.type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'" } });
    }
    if (request.method !== 'POST' || url.pathname !== '/api/chat') return json(404, { error: 'Not found' });
    if (!request.headers.get('content-type')?.startsWith('application/json')) return json(415, { error: 'Expected JSON' });
    if (missing.length) return json(503, { error: 'The site owner needs to configure the API connection.' });
    let messages, mode;
    try {
      let body = ''; const decoder = new TextDecoder();
      if (!request.body) return json(400, { error: 'Expected messages' });
      for await (const part of request.body) {
        body += decoder.decode(part, { stream: true });
        if (body.length > 60000) return json(413, { error: 'Conversation is too large. Start a new chat.' });
      }
      body += decoder.decode();
      const payload = JSON.parse(body);
      mode = payload.mode ?? 'safety'; getMode(mode);
      messages = payload.messages;
      if (!Array.isArray(messages) || !messages.length || messages.length > 40 || messages.at(-1)?.role !== 'user' || messages.some(m => !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string' || !m.content.trim() || m.content.length > 12000)) throw new Error();
      messages = messages.map(({ role, content }) => ({ role, content }));
    } catch { return json(400, { error: 'Send 1–40 text messages, each under 12,000 characters.' }); }
    const abort = new AbortController();
    const deadline = setTimeout(() => abort.abort(), 180000);
    const onAbort = () => abort.abort();
    request.signal.addEventListener('abort', onAbort, { once: true });
    if (request.signal.aborted) abort.abort();
    let cancelled = false;
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        const emit = (event, data) => { if (!cancelled) controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); };
        void runChat({ env, messages, emit, abort, mode }).catch(() => {
          emit('error', { message: 'The response could not complete.' });
        }).finally(() => {
          clearTimeout(deadline); request.signal.removeEventListener('abort', onAbort);
          if (!cancelled) controller.close();
        });
      },
      cancel() { cancelled = true; abort.abort(); clearTimeout(deadline); },
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
  },
};
