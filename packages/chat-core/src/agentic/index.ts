/**
 * @jini/chat-core/agentic — the chat pane's own capability manifest.
 *
 * Everything that used to live here besides `chat-capabilities.ts` (the framework-free
 * `CapabilityDef` vocabulary, the two shipped manifests' shared machinery, the `data-agent-*`
 * markup convention, and the protocol projections) moved to `@jini/agentic` on 2026-07-26 — see
 * `packages/agentic/source-map.md` for the extraction and why. This barrel now only exports
 * `CHAT_CAPABILITIES`, the seven `chat.*` verbs that are a genuine chat product surface rather
 * than generic vocabulary, and re-exports `CapabilityDef` from `@jini/agentic` purely for
 * `chat-react`'s older `agent-tools.ts` compatibility shim (which still names it via
 * `@jini/chat-core`) — new code should import `CapabilityDef` from `@jini/agentic` directly.
 */
export { CHAT_CAPABILITIES } from './chat-capabilities.js';
export type { CapabilityDef, CapabilityInputSchema, CapabilityRisk } from '@jini/agentic';
