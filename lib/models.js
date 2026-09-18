export const models = [
  { id: 'qwen/qwen3-8b', name: 'Qwen3 8B' },
  { id: 'openai/gpt-5.4-nano', name: 'GPT-5.4 Nano' },
  { id: 'meta-llama/llama-3.2-1b-instruct', name: 'Llama 3.2 1B' },
];
export function selectModel(model = models[0].id) {
  if (!models.some(candidate => candidate.id === model)) throw new Error('Choose a supported OpenRouter model.');
  return model;
}
