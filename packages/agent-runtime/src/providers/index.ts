/**
 * @module providers
 *
 * Generic LLM-provider integration material ported from OD's
 * `apps/daemon/src/integrations/` (13 files). See `source-map.md` for the
 * full per-file provenance and the MIXED-classification split: OD's own
 * AMR/vela provider adapter (`vela*.ts`, 4 files) is a specific provider's
 * own daemon-coupled implementation, not generic material, and was left
 * unported.
 *
 * `sse-decode.ts` / `anthropic-messages.ts` / `openai-chat.ts` (2026-07-21),
 * and `google-messages.ts` / `azure-chat.ts` / `ollama-chat.ts`
 * (2026-07-22), are the one exception to "ported": built fresh against
 * each provider's real public API docs rather than lifted from OD's
 * `chat.ts` (this task did not have direct access to that file for the
 * 2026-07-21 pass; the 2026-07-22 pass did read the real OD source for
 * Azure's api-version default — see `azure-chat.ts`'s header) — see each
 * module's own header and `source-map.md`'s dated sections for the full
 * rationale.
 */
export * from './types.js';
export * from './token-params.js';
export * from './google.js';
export * from './aihubmix.js';
export * from './connection-guard.js';
export * from './model-catalog.js';
export * from './connection-test.js';
export * from './sse-decode.js';
export * from './anthropic-messages.js';
export * from './openai-chat.js';
export * from './google-messages.js';
export * from './azure-chat.js';
export * from './ollama-chat.js';
export * from './elevenlabs.js';
export * from './pkce.js';
export * from './oauth-provider.js';
export * from './oauth-callback-server.js';
export * from './oauth-tokens.js';
export * from './oauth-credentials.js';
