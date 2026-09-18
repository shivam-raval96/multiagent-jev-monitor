import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, createTokenMonitor, tokenQuestions, parseTokenAnswers } from '../lib/token-monitor.js';

test('lexical tokens survive fragmented words, whitespace, punctuation, and Unicode', () => {
  assert.deepEqual(tokenize('hap'), []);
  assert.equal(tokenize('happy ')[0].text, 'happy');
  const text = 'happy  sad!\n🌱 café';
  const tokens = tokenize(text, true);
  assert.equal(tokens.map(t => t.text).join(''), text);
  for (const token of tokens) assert.equal(text.slice(token.start, token.end), token.text);
});

test('every token-category pair is a separate question with an explicit target', () => {
  const tokens = tokenize('happy sad', true);
  const questions = tokenQuestions(tokens, 'emotions');
  assert.equal(Object.keys(questions).length, tokens.length * 6);
  assert.match(questions.t0_joy.instructions, /tokens\[0\]/);
  assert.match(questions.t2_joy.instructions, /tokens\[2\]/);
  assert.throws(() => parseTokenAnswers({ answers: {} }, tokens, 'emotions'));
});

test('monitor drains every token, retries failed batches, never overlaps work', async () => {
  const events = []; let calls = 0, active = 0;
  const monitor = createTokenMonitor({ emit: (event, data) => events.push({ event, ...data }), batchSize: 2, evaluate: async ({ tokens }) => {
    assert.equal(active++, 0);
    try { if (++calls === 1) throw new Error('Unavailable'); return { tokens: tokens.map(t => ({ ...t, probabilities: { joy: t.id / 10 } })) }; }
    finally { active--; }
  } });
  monitor.update('happy sad!'); await monitor.finish();
  const scored = events.filter(e => e.event === 'evaluation').flatMap(e => e.tokens);
  assert.deepEqual(scored.map(t => t.id).sort(), [0,1,2,3]);
  assert.equal(events.filter(e => e.event === 'evaluation-error').length, 1);
});

test('cancellation stops pending evaluation batches', async () => {
  const abort = new AbortController(); let calls = 0;
  const monitor = createTokenMonitor({ signal: abort.signal, emit() {}, batchSize: 1, evaluate: async () => { calls++; abort.abort(); throw new Error('Aborted'); } });
  monitor.update('one two three'); await monitor.finish(); assert.equal(calls, 1);
});
