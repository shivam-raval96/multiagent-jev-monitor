import 'dotenv/config';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dimensions } from './lib/policy.js';
import { runChat } from './lib/chat.js';

export function createApp(env = process.env) {
  const missing = ['TYPESAFE_API_KEY', 'LLM_API_KEY', 'LLM_MODEL'].filter(key => !env[key]);
  let active = false;
  return http.createServer(async (req, res) => {
    const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    const origin = req.headers.origin;
    const host = req.headers.host;
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host || '') || (origin && origin !== `http://${host}`)) return json(403, { error: 'Local same-origin requests only.' });
    const path = new URL(req.url, `http://${host}`).pathname;
    if (req.method === 'GET' && path === '/api/config') return json(200, { missing, model: env.LLM_MODEL || 'Model not configured', evaluator: env.TYPESAFE_MODEL || 'jev-latest', dimensions });
    if (req.method === 'GET') {
      const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/heatmap.js': ['heatmap.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
      if (!files[path]) return json(404, { error: 'Not found' });
      try {
        const [file, type] = files[path];
        res.writeHead(200, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'" });
        res.end(await readFile(new URL(`./public/${file}`, import.meta.url)));
      } catch { res.end('Unable to load application'); }
      return;
    }
    if (req.method !== 'POST' || path !== '/api/chat') return json(404, { error: 'Not found' });
    if (!req.headers['content-type']?.startsWith('application/json')) return json(415, { error: 'Expected JSON' });
    if (missing.length) return json(503, { error: `Add ${missing.join(', ')} to .env and restart the server.` });
    if (active) return json(429, { error: 'A response is already running. Please wait or stop it.' });
    let messages;
    try {
      let body = '';
      for await (const part of req) {
        body += part;
        if (body.length > 60000) throw new Error('Conversation is too large. Start a new chat.');
      }
      messages = JSON.parse(body).messages;
      if (!Array.isArray(messages) || !messages.length || messages.length > 40 || messages.at(-1)?.role !== 'user' || messages.some(m => !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string' || !m.content.trim() || m.content.length > 12000)) throw new Error('Send 1–40 text messages, each under 12,000 characters.');
      messages = messages.map(({ role, content }) => ({ role, content }));
    } catch (e) { return json(400, { error: e.message }); }
    active = true;
    const abort = new AbortController();
    const deadline = setTimeout(() => abort.abort(), 180000);
    res.on('close', () => abort.abort());
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const emit = (event, data) => { if (!res.destroyed && !res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
    try { await runChat({ env, messages, emit, abort }); }
    finally { clearTimeout(deadline); active = false; res.end(); }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  createApp().listen(port, '127.0.0.1', () => console.log(`Jev monitor: http://localhost:${port}`));
}
