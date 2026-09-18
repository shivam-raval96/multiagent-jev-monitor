import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../server.js';
import { readSSE } from '../lib/sse.js';
import { models } from '../lib/models.js';
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
const close = server => { server.closeAllConnections(); server.close(); };
const post = (url, data) => fetch(`${url}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });

test('SSE preserves fragmented Unicode and ignores provider comments', async () => {
  const bytes = new TextEncoder().encode(': OPENROUTER PROCESSING\r\n\r\ndata: {"text":"🌱"}\r\n\r\ndata: [DONE]\n\n');
  async function* chunks() { for (const byte of bytes) yield Uint8Array.of(byte); }
  const out = []; for await (const d of readSSE(chunks())) out.push(d);
  assert.deepEqual(out, ['{"text":"🌱"}', '[DONE]']);
});

test('both modes route every selected OpenRouter model and return independent token scores', async t => {
  let generation, evaluation;
  const upstream = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body);
    if (req.url === '/v1/systemone') {
      evaluation = payload;
      const answers = Object.fromEntries(Object.keys(payload.questions).map((id, i) => [id, { type: 'noul', noul: i / 100 }]));
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ answers, model: 'jev-test', usage: {} }));
    } else {
      generation = payload;
      assert.equal(req.headers.authorization, 'Bearer router-test');
      res.end('data: {"choices":[{"delta":{"content":"Happy sad!"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
    }
  });
  const base = await listen(upstream); t.after(() => close(upstream));
  const app = createApp({ TYPESAFE_API_KEY: 'test', TYPESAFE_BASE_URL: base, OPENROUTER_API_KEY: 'router-test', OPENROUTER_BASE_URL: base });
  const url = await listen(app); t.after(() => close(app));
  for (const mode of ['safety', 'emotions']) for (const model of models) {
    const response = await post(url, { mode, model: model.id, messages: [{ role: 'user', content: 'Hi' }] });
    const events = []; for await (const data of readSSE(response.body)) events.push(JSON.parse(data));
    assert.equal(generation.model, model.id); assert.equal(generation.max_tokens, 512);
    assert.equal(evaluation.state.complete, true);
    assert.equal(Object.keys(evaluation.questions).length, 24);
    const scored = events.filter(e => e.tokens?.[0]?.probabilities).flatMap(e => e.tokens);
    assert.equal(scored.length, 4);
    assert.equal(scored.map(t => t.text).join(''), 'Happy sad!');
    assert.notDeepEqual(scored[0].probabilities, scored[2].probabilities);
    assert.deepEqual(Object.keys(scored[0].probabilities), mode === 'safety' ? ['harm','hate','self_harm','privacy','medical','refusal'] : ['joy','sadness','anger','fear','surprise','disgust']);
  }
  assert.equal((await post(url, { model: 'unapproved', messages: [{ role: 'user', content: 'Hi' }] })).status, 400);
  assert.equal((await post(url, { mode: '__proto__', messages: [{ role: 'user', content: 'Hi' }] })).status, 400);
  assert.equal((await fetch(`${url}/.env`)).status, 404);
  assert.equal((await fetch(`${url}/api/chat`, { method: 'POST', headers: { Origin: 'https://evil.example' } })).status, 403);
});

test('missing OpenRouter key never silently uses existing OpenAI credentials', async t => {
  const app = createApp({ TYPESAFE_API_KEY: 'test', LLM_API_KEY: 'old-key' });
  const url = await listen(app); t.after(() => close(app));
  const config = await (await fetch(`${url}/api/config`)).json();
  assert.deepEqual(config.missing, ['OPENROUTER_API_KEY']);
  assert.equal((await post(url, {})).status, 503);
  assert.ok(!JSON.stringify(config).includes('old-key'));
});

test('upstream errors do not expose private response bodies', async t => {
  const upstream = http.createServer((req, res) => { res.writeHead(401); res.end('sensitive upstream body'); });
  const base = await listen(upstream); t.after(() => close(upstream));
  const app = createApp({ TYPESAFE_API_KEY: 'test', OPENROUTER_API_KEY: 'test', OPENROUTER_BASE_URL: base });
  const url = await listen(app); t.after(() => close(app));
  const text = await (await post(url, { messages: [{ role: 'user', content: 'Hi' }] })).text();
  assert.match(text, /HTTP 401/); assert.doesNotMatch(text, /sensitive upstream body|event: done/);
});
