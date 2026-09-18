import { getMode } from './policy.js';

// Readable tokens, independent of provider chunk boundaries. The final lexical
// unit is held until more text arrives so 'hap' + 'py' becomes one token.
export function tokenize(text, final = false) {
  const matches = [...text.matchAll(/\s+|[\p{L}\p{N}\p{M}_]+|[^\s\p{L}\p{N}\p{M}_]/gu)];
  if (!final && matches.length) matches.pop();
  return matches.map((m, id) => ({ id, text: m[0], start: m.index, end: m.index + m[0].length }));
}
export function tokenQuestions(tokens, mode) {
  const { dimensions, questions } = getMode(mode);
  return Object.fromEntries(tokens.flatMap((token, index) => dimensions.map(d => [`t${token.id}_${d.id}`, {
    type: 'noul',
    instructions: `Evaluate ONLY the target token at \`tokens[${index}]\` (text and exact character offsets in \`response\`). What is the probability that this particular token, in context, contributes to the following criterion? ${d.yes} Use surrounding response and conversation to interpret its meaning, including negation. Do not assign a whole-response score to every token. Neutral words, punctuation, and whitespace that do not carry this meaning should score low. ${questions[d.id].instructions} The target token is the unit being classified, not the full response.`,
    criteria: { true: 'This target token contributes to expressing the criterion in context.', false: 'This target token does not contribute to expressing the criterion in context.' },
  }])));
}
export function parseTokenAnswers(result, tokens, mode) {
  return tokens.map(token => ({ ...token, probabilities: Object.fromEntries(getMode(mode).dimensions.map(d => {
    const answer = result.answers?.[`t${token.id}_${d.id}`];
    if (answer?.type !== 'noul' || !Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1) throw new Error('Invalid token probability');
    return [d.id, answer.noul];
  })) }));
}
export function createTokenMonitor({ evaluate, emit, interval = 600, batchSize = 8, signal }) {
  let text = '', tokens = [], next = 0, running = null, closing = false, sequence = 0;
  const failed = [];
  function update(value, final = false) {
    text = value;
    const nextTokens = tokenize(text, final);
    const added = nextTokens.slice(tokens.length);
    tokens = nextTokens;
    if (added.length) emit('tokens', { tokens: added });
  }
  async function batch(targets, complete) {
    const seq = ++sequence, started = performance.now();
    const response = text;
    emit('evaluation-start', { sequence: seq, tokenIds: targets.map(t => t.id) });
    try {
      const result = await evaluate({ response, tokens: targets, complete });
      emit('evaluation', { ...result, sequence: seq, complete, latency: Math.round(performance.now() - started) });
    } catch (error) {
      emit('evaluation-error', { sequence: seq, tokenIds: targets.map(t => t.id), message: error.message, complete });
      return false;
    }
    return true;
  }
  async function step(complete) {
    const targets = tokens.slice(next, next + batchSize); next += targets.length;
    if (targets.length && !await batch(targets, complete)) failed.push(targets);
  }
  const timer = setInterval(() => {
    if (signal?.aborted || closing || running || next >= tokens.length) return;
    running = step(false).finally(() => { running = null; });
  }, interval);
  return {
    update,
    async finish(complete = true) {
      closing = true; clearInterval(timer); update(text, true); await running;
      while (!signal?.aborted && next < tokens.length) await step(complete);
      // Retry a failed batch once at the end; never invent safe probabilities.
      for (const targets of failed) { if (signal?.aborted) break; await batch(targets, complete); }
    },
    cancel() { closing = true; clearInterval(timer); },
  };
}
