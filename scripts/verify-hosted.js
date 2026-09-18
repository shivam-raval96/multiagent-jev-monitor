import assert from 'node:assert/strict';
import http from 'node:http';
import worker from '../dist/server/index.js';
import { dimensions } from '../lib/policy.js';

let finalState;
const provider = http.createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  if (req.url === '/v1/systemone') {
    finalState = JSON.parse(body).state;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ model: 'jev-test', answers: Object.fromEntries(dimensions.map(d => [d.id, { type: 'noul', noul: 0.1 }])), usage: {} }));
  } else {
    res.setHeader('Content-Type', 'text/event-stream');
    res.end('data: {"choices":[{"delta":{"content":"Hello."},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  }
});
await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
try {
  const base = `http://127.0.0.1:${provider.address().port}`;
  const env = { TYPESAFE_API_KEY: 'test-secret', TYPESAFE_BASE_URL: base, LLM_API_KEY: 'test-secret', LLM_BASE_URL: base, LLM_MODEL: 'test' };
  for (const path of ['/', '/app.js', '/heatmap.js', '/style.css']) {
    const response = await worker.fetch(new Request(`https://test.example${path}`), env);
    assert.equal(response.status, 200); assert.ok((await response.text()).length > 0);
  }
  assert.equal((await worker.fetch(new Request('https://test.example/.env'), env)).status, 404);
  const config = await worker.fetch(new Request('https://test.example/api/config'), env);
  assert.ok(!(await config.text()).includes('test-secret'));
  const response = await worker.fetch(new Request('https://test.example/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://test.example' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello' }] }) }), env);
  const events = await response.text();
  assert.match(events, /event: token/); assert.match(events, /event: evaluation\n/); assert.match(events, /event: done/);
  assert.equal(finalState.complete, true); assert.equal(finalState.response, 'Hello.');
  const denied = await worker.fetch(new Request('https://test.example/api/chat', { method: 'POST', headers: { Origin: 'https://other.example' } }), env);
  assert.equal(denied.status, 403);
  console.log('Hosted Worker verified: assets, private-file exclusion, secret redaction, same-origin policy, streaming, six judgments, final assessment.');
} finally { provider.closeAllConnections(); provider.close(); }
