import test from 'node:test';
import assert from 'node:assert/strict';
import { textSegments, signalColor } from '../public/heatmap.js';
import { dimensions, questions } from '../lib/policy.js';

test('snapshot colors cover only assessed text and preserve earlier history', () => {
  const first = { harm: 0.1, refusal: 0.8 };
  const second = { harm: 0.9, refusal: 0.2 };
  const segments = textSegments('abcdef', [
    { chars: 2, sequence: 1, probabilities: first },
    { chars: 4, sequence: 2, message: 'Failed' },
    { chars: 5, sequence: 3, probabilities: second },
    { chars: 5, sequence: 4, probabilities: first, complete: true },
  ]);
  assert.deepEqual(segments.map(s => [s.text, s.probabilities]), [['ab', first], ['cde', second], ['f', null]]);
  assert.equal(segments.map(s => s.text).join(''), 'abcdef');
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
