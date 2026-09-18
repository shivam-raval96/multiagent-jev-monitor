import test from 'node:test';
import assert from 'node:assert/strict';
import { textSegments, signalColor } from '../public/heatmap.js';
import { dimensions, questions } from '../lib/policy.js';

test('each token retains its own probability map; unassessed tokens stay unknown', () => {
  const tokens = [{ id: 0, text: 'happy', start: 0, end: 5 }, { id: 1, text: ' ', start: 5, end: 6 }, { id: 2, text: 'sad', start: 6, end: 9 }];
  const segments = textSegments('happy sad', [{ tokens: [{ ...tokens[0], probabilities: { joy: 0.9 } }, { ...tokens[2], probabilities: { joy: 0.1 } }] }], tokens);
  assert.equal(segments.length, 3); assert.equal(segments[0].probabilities.joy, 0.9); assert.equal(segments[1].probabilities, null); assert.equal(segments[2].probabilities.joy, 0.1);
});

test('max signal uses winning category hue; isolation ignores larger signals', () => {
  const probabilities = { harm: 0.4, refusal: 0.9 };
  assert.equal(signalColor(probabilities, dimensions).dimension.id, 'refusal');
  const isolated = signalColor(probabilities, dimensions, 'harm');
  assert.equal(isolated.dimension.id, 'harm');
  assert.equal(isolated.probability, 0.4);
  assert.equal(signalColor(null, dimensions), null);
});

test('colors interpolate linearly from white to category endpoint', () => {
  const dims = [{ id: 'example', color: '#4080c0' }];
  assert.equal(signalColor({ example: 0 }, dims).color, 'rgb(255, 255, 255)');
  assert.equal(signalColor({ example: 0.5 }, dims).color, 'rgb(160, 192, 224)');
  assert.equal(signalColor({ example: 1 }, dims).color, 'rgb(64, 128, 192)');
});

test('refusal is a distinct judgment without excluding refusals', () => {
  assert.equal(questions.refusal.type, 'noul');
  assert.match(questions.refusal.instructions, /refusal may be partial/);
  assert.doesNotMatch(questions.refusal.instructions, /A refusal, neutral quotation/);
  assert.equal(new Set(dimensions.map(d => d.color)).size, dimensions.length);
});
