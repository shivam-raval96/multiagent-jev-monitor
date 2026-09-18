// Prefix-level judgments are assigned only to newly covered text. Later final
// checks do not erase the history by painting every prior token the same color.
export function textSegments(text, checks) {
  const segments = [];
  let covered = 0;
  for (const check of checks) {
    if (!check.probabilities) continue;
    const end = Math.min(text.length, check.chars);
    if (end <= covered) continue;
    segments.push({ text: text.slice(covered, end), probabilities: check.probabilities, sequence: check.sequence });
    covered = end;
  }
  if (covered < text.length) segments.push({ text: text.slice(covered), probabilities: null });
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
