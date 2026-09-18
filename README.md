# Jev streaming safety monitor

A small local chatbot with an OpenAI-compatible streaming generator and TypeSafe Jev judgments alongside each response. Node.js 20.17+; no frontend build step.

## Run

```sh
npm install
cp .env.example .env
# Set TYPESAFE_API_KEY, LLM_API_KEY, and LLM_MODEL in .env.
npm run dev
```

Open http://localhost:3000. The provider must support `/chat/completions`, `stream: true`, `max_completion_tokens`, and SSE `[DONE]`. Set `LLM_BASE_URL` to its API root. The default root is OpenAI; choose a model available to your account. Both API keys stay on the server. Restart after changing `.env`. The app binds only to loopback and permits same-origin requests; the local server remains a development tool. The hosted version uses the private Sites access gate and a Workers-compatible entrypoint.

## Design

- Tokens pass straight to the chat. This is **monitoring**, not a blocking moderation gateway: text is visible before evaluation.
- Every 900 ms, if text changed and no evaluation is running, the latest full response prefix is sent to Jev with conversation context. Intermediate snapshots are coalesced rather than queued.
- Six independent Noul questions share one `systemOne` call. Each value is the probability its hazard criterion holds, **not** severity or a separate confidence score. Questions explicitly judge assistant output and distinguish endorsement from refusal or neutral discussion.
- A final evaluation runs after generation, even if the previous snapshot covered the same text. Results include sequence, assessed character count, latency, model, and token usage. The UI identifies partial coverage. Failed evaluations are unknown, never zero-risk.
- Response text uses a linear white-to-category color scale. Each segment receives the probabilities from the first successful snapshot covering it; later snapshots color newly covered text rather than erasing earlier history. The default color is the category with the largest probability, including refusal. Hovering or keyboard-focusing a category isolates it across responses. Gray text is unassessed. These are prefix judgments, not independent token-level classifications. Refusal describes behavior, not a violation.
- Threshold changes reuse probabilities. The default 70% highlight is illustrative and needs validation on representative labeled data. No aggregate average can hide a high individual signal.
- Stop/disconnect aborts generation and TypeSafe requests. Cancelled text beyond the last successful snapshot remains unassessed. Generation errors retain partial text. Each response's signals remain inspectable.
- Conversations live in browser memory. Context and response prefixes go to the configured LLM provider and TypeSafe, respectively (TypeSafe receives context too). No application message storage or logging.

Edit `lib/policy.js` to change dimensions and criteria. Long conversations are rejected with an instruction to start a new chat; no silent context truncation. TypeSafe retries use SDK defaults with a 10-second per-attempt timeout; a turn has a three-minute total deadline.

## Validation

```sh
npm test
```

Tests use local mock providers to verify the wire contract and streaming workflow, including final assessment and upstream failures. Real model quality and latency require configured keys and representative examples; mocked results do not establish calibration.

## References

- [TypeSafe HTTP API](https://docs.typesafe.ai/api)
- [TypeSafe JavaScript SDK](https://docs.typesafe.ai/sdk/javascript)
- [Guardrails cookbook](https://docs.typesafe.ai/cookbooks/llm_guardrails)
- [Noul probabilities](https://docs.typesafe.ai/primitives/noul)
- [OpenAI streaming](https://developers.openai.com/api/docs/guides/streaming-responses)

## Hosted deployment

`worker.js` serves the same UI and shared `lib/chat.js` streaming logic on Sites. `npm run build` bundles the Worker and assets into `dist/server/index.js`; `npm run test:hosted` verifies the built artifact against a local mock provider. Runtime API keys are hosting secrets, never build inputs. Keep Sites access private; this app does not implement its own user accounts or per-user quotas.
