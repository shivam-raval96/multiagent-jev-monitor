# Jev token signal monitor

A streaming chatbot using OpenRouter for generation and TypeSafe Jev for individual token judgments. Choose Safety or Emotions, then choose a generator model.

## Run locally

```sh
npm install
cp .env.example .env
# Set TYPESAFE_API_KEY and OPENROUTER_API_KEY in .env.
npm run dev
```

Open http://localhost:3000. Restart after changing `.env`. Keys remain server-side. The old `LLM_API_KEY` is never sent to OpenRouter. Hosted runtime values are configured separately as Sites secrets.

## Models

The curated model selector routes these IDs, verified against OpenRouter's catalog:

- Qwen3 8B: `qwen/qwen3-8b`
- GPT-5.4 Nano: `openai/gpt-5.4-nano` (OpenRouter's alias, not the dated OpenAI endpoint ID)
- Llama 3.2 1B: `meta-llama/llama-3.2-1b-instruct`

Availability and routing depend on OpenRouter providers. Generation is capped at 512 model output tokens per response to bound token evaluation work. `OPENROUTER_BASE_URL` exists only as a server configuration override for testing; the browser cannot select arbitrary endpoints or unapproved model IDs.

## Per-token evaluation

**Displayed tokens are readable word, punctuation, and whitespace units, not the generator's native subword token IDs.** Stream chunk boundaries do not define tokens. Incomplete trailing units are held until stable; Unicode and original text are preserved.

Every token/category pair gets its own Noul question. Up to eight tokens (48 independent questions) share a TypeSafe request. Questions identify the target token by text and offsets and ask whether it contributes to the category **in context**. We do not copy one response-prefix probability onto multiple tokens. Each token is scored using the context available when its batch is sent; earlier scores are not retroactively re-evaluated after later text arrives.

A failed batch is retried once at the end, after the SDK's normal transport retries. Failed/unassessed tokens remain gray, never zero-risk. Generation and evaluation share a five-minute deadline; stopping or disconnecting aborts upstream work. This is monitoring: text can be seen before classification.

- Each token has a distinct background and outline. White-to-category colors interpolate linearly with probability.
- Default coloring uses each token's maximum category probability and that category's hue.
- Hover/focus a category to isolate it. Hover/focus a token to see all category probabilities.
- Sidebar bars show each category's maximum across assessed tokens; they are not whole-response probabilities.
- Safety includes harmful assistance, hate/harassment, self-harm encouragement, privacy exposure, unsafe medical advice, and refusal. Refusal is behavior, not a violation.
- Emotions includes joy, sadness, anger, fear, surprise, and disgust. Multiple emotions may coexist; probabilities are not intensity scores.
- Each response retains its own mode, model, and token probabilities. Suggestions fill the composer without sending automatically.

These token attribution judgments require validation against representative labeled examples; typed probabilities do not guarantee correct semantic attribution. Per-token scoring sends more questions than the former snapshot approach and can cost more or take longer.

Conversations live in browser memory. The conversation goes to OpenRouter; TypeSafe receives conversation context, response text, and target tokens. No application message logging or storage.

## Validation and hosting

```sh
npm test
npm run test:hosted
```

Tests verify model selection, stream framing, per-token question construction, independent results, retry/cancellation behavior, and both evaluation modes. Hosted checks use mock providers against the built Worker. Live generation requires an OpenRouter key.

`server.js` is the loopback-only local server. `worker.js` serves the same UI and shared chat logic on private Sites hosting. `npm run build` bundles the Worker and assets into `dist/server/index.js`. Keep access private; there are no app-owned user accounts or per-user quotas. API keys are runtime secrets, never build inputs.

## References

- [TypeSafe API](https://docs.typesafe.ai/api)
- [TypeSafe parallel questions](https://docs.typesafe.ai/cookbooks/parallel_questions)
- [OpenRouter API](https://openrouter.ai/docs/api-reference/overview)
- [OpenRouter models](https://openrouter.ai/models)
