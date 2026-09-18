import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { createApp } from '../server.js';
import { createMonitor } from '../lib/monitor.js';
import { readSSE } from '../lib/sse.js';
import { dimensions, parseAnswers } from '../lib/policy.js';

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
const close = server => { server.closeAllConnections(); server.close(); };
const answers = () => Object.fromEntries(dimensions.map(d => [d.id, { type: 'noul', noul: 0.12 }]));

test('SSE parser preserves fragmented Unicode and CRLF frames', async () => {
  const bytes = new TextEncoder().encode('data: {"text":"🌱"}\r\n\r\ndata: [DONE]\n\n');
  async function* chunks() { for (const byte of bytes) yield Uint8Array.of(byte); }
  const out = []; for await (const d of readSSE(chunks())) out.push(d);
  assert.deepEqual(out, ['{"text":"🌱"}', '[DONE]']);
});

test('invalid or missing probabilities cannot become safe zeros', () => {
  assert.throws(() => parseAnswers({ answers: {} }));
  const a = answers(); a.harm.noul = NaN;
  assert.throws(() => parseAnswers({ answers: a }));
});

test('monitor serializes requests, coalesces tokens, and checks final state', async () => {
  let release; let entered;
  const started = new Promise(r => { entered = r; });
  const blocked = new Promise(r => { release = r; });
  const calls = []; const events = [];
  const monitor = createMonitor({ interval: 5, emit: (e, d) => events.push([e, d]), evaluate: async (text, complete) => { calls.push({ text, complete }); if (calls.length === 1) { entered(); await blocked; } return { probabilities: { harm: 0.1 } }; } });
  monitor.update('a'); await started;
  monitor.update('ab'); monitor.update('abc');
  const finish = monitor.finish(); release(); await finish;
  assert.deepEqual(calls, [{ text: 'a', complete: false }, { text: 'abc', complete: true }]);
  assert.deepEqual(events.filter(([e]) => e === 'evaluation').map(([, d]) => d.chars), [1, 3]);
});

test('evaluation failure is explicit and final evaluation can recover', async () => {
  const events = []; let calls = 0; let notify;
  const failed = new Promise(r => { notify = r; });
  const monitor = createMonitor({ interval: 5, emit: (e, d) => { events.push([e, d]); if (e === 'evaluation-error') notify(); }, evaluate: async () => { if (++calls === 1) throw new Error('Unavailable'); return { probabilities: { harm: 0.1 } }; } });
  monitor.update('sample'); await failed; await monitor.finish();
  assert.equal(events.filter(([e]) => e === 'evaluation-error').length, 1);
  assert.equal(events.at(-1)[1].complete, true);
});

test('HTTP integration streams tokens and sends all dimensions with final context', async t => {
  const evaluations = []; let llmBody;
  const upstream = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body);
    if (req.url === '/v1/systemone') {
      evaluations.push(payload); res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ answers: Object.fromEntries(Object.keys(payload.questions).map(id => [id, { type: 'noul', noul: 0.12 }])), model: 'jev-test', usage: { input_tokens: 50, output_tokens: 5 } }));
    } else {
      llmBody = payload;
      res.setHeader('Content-Type', 'text/event-stream');
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Hello ' } }] })}\n\n`);
      await delay(1050);
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'world.' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    }
  });
  const base = await listen(upstream); t.after(() => close(upstream));
  const app = createApp({ TYPESAFE_API_KEY: 'test', TYPESAFE_BASE_URL: base, LLM_API_KEY: 'test', LLM_MODEL: 'test', LLM_BASE_URL: `${base}/v1` });
  const url = await listen(app); t.after(() => close(app));
  const response = await fetch(`${url}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'Hi' }] }) });
  const events = []; for await (const data of readSSE(response.body)) events.push(JSON.parse(data));
  assert.equal(events.filter(e => e.text).map(e => e.text).join(''), 'Hello world.');
  assert.equal(evaluations.length, 2);
  assert.equal(evaluations.at(-1).state.complete, true);
  assert.equal(evaluations.at(-1).state.response, 'Hello world.');
  assert.equal(Object.keys(evaluations.at(-1).questions).length, 6);
  assert.equal(llmBody.stream, true);
  const emotionResponse = await fetch(`${url}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'emotions', messages: [{ role: 'user', content: 'Celebrate with me!' }] }) });
  const emotionEvents = await emotionResponse.text();
  assert.match(emotionEvents, /"mode":"emotions"/);
  assert.match(emotionEvents, /"joy":0.12/);
  assert.deepEqual(Object.keys(evaluations.at(-1).questions), ['joy', 'sadness', 'anger', 'fear', 'surprise', 'disgust']);
  const invalid = await fetch(`${url}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: '__proto__', messages: [{ role: 'user', content: 'Hi' }] }) });
  assert.equal(invalid.status, 400);

  assert.equal(events.find(e => e.complete && e.probabilities).chars, 12);
  const forbidden = await fetch(`${url}/api/chat`, { method: 'POST', headers: { Origin: 'https://example.com', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(forbidden.status, 403);
});

test('missing configuration is explicit; private files are never served', async t => {
  const app = createApp({}); const url = await listen(app); t.after(() => close(app));
  const response = await fetch(`${url}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /TYPESAFE_API_KEY/);
  assert.equal((await fetch(`${url}/.env`)).status, 404);
});

test('provider errors appear in stream without exposing upstream body', async t => {
  const upstream = http.createServer((req, res) => { res.writeHead(401); res.end('sensitive upstream body'); });
  const base = await listen(upstream); t.after(() => close(upstream));
  const app = createApp({ TYPESAFE_API_KEY: 'test', LLM_API_KEY: 'test', LLM_MODEL: 'test', LLM_BASE_URL: base });
  const url = await listen(app); t.after(() => close(app));
  const response = await fetch(`${url}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'Hi' }] }) });
  const body = await response.text(); assert.match(body, /HTTP 401/); assert.doesNotMatch(body, /sensitive upstream body/); assert.doesNotMatch(body, /event: done/);
});

test('premature upstream EOF is interrupted, with partial text assessed', async t => {
  let complete;
  const upstream = http.createServer(async (req, res) => {
    let body = ''; for await (const part of req) body += part;
    if (req.url === '/v1/systemone') {
      complete = JSON.parse(body).state.complete;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ answers: answers(), model: 'jev-test', usage: {} }));
    } else { res.end('data: {"choices":[{"delta":{"content":"Partial"}}]}\n\n'); }
  });
  const base = await listen(upstream); t.after(() => close(upstream));
  const app = createApp({ TYPESAFE_API_KEY: 'test', TYPESAFE_BASE_URL: base, LLM_API_KEY: 'test', LLM_MODEL: 'test', LLM_BASE_URL: base });
  const url = await listen(app); t.after(() => close(app));
  const response = await fetch(`${url}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'Hi' }] }) });
  const body = await response.text();
  assert.match(body, /disconnected before completion/); assert.doesNotMatch(body, /event: done/); assert.equal(complete, false);
});

test('client cancellation closes the upstream stream', async t => {
  let signalClosed;
  const closed = new Promise(r => { signalClosed = r; });
  const upstream = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"choices":[{"delta":{"content":"Beginning"}}]}\n\n');
    res.on('close', signalClosed);
  });
  const base = await listen(upstream); t.after(() => close(upstream));
  const app = createApp({ TYPESAFE_API_KEY: 'test', LLM_API_KEY: 'test', LLM_MODEL: 'test', LLM_BASE_URL: base });
  const url = await listen(app); t.after(() => close(app));
  const controller = new AbortController();
  const response = await fetch(`${url}/api/chat`, { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'Hi' }] }) });
  const reader = response.body.getReader(); await reader.read(); controller.abort();
  await Promise.race([closed, delay(1500).then(() => { throw new Error('Upstream was not cancelled'); })]);
});
