// Every displayed token has its own judgment map; no prefix-score reuse.
export function textSegments(text, checks, tokens = []) {
  const scores = new Map();
  for (const check of checks) for (const token of check.tokens || []) scores.set(token.id, token.probabilities);
  const segments = tokens.map(token => ({ ...token, probabilities: scores.get(token.id) || null }));
  const covered = tokens.at(-1)?.end || 0;
  if (covered < text.length) segments.push({ id: 'pending', text: text.slice(covered), probabilities: null });
  return segments;
}

export function signalColor(probabilities, dimensions, category = null) {
  if (!probabilities) return null;
  const candidates = dimensions.filter(d => (!category || d.id === category) && Number.isFinite(probabilities[d.id]));
  const dimension = candidates.reduce((best, d) => !best || probabilities[d.id] > probabilities[best.id] ? d : best, null);
  if (!dimension) return null;
  const probability = Math.max(0, Math.min(1, probabilities[dimension.id]));
  const rgb = dimension.color.slice(1).match(/../g).map(hex => parseInt(hex, 16));
  // Linear interpolation in sRGB from white at 0 to the category color at 1.
  const color = `rgb(${rgb.map(channel => Math.round(255 + (channel - 255) * probability)).join(', ')})`;
  return { color, probability, dimension };
}
