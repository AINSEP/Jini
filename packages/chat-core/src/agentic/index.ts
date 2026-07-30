/**
 * @jini-ai/chat-core's internal `agentic/` barrel — the chat pane's own capability manifest. Not a
 * public subpath (there is no `"./agentic"` entry in package.json); re-exported from this
 * package's root `index.ts` instead.
 *
 * Everything that used to live here besides `chat-capabilities.ts` (the framework-free
 * `CapabilityDef` vocabulary, the two shipped manifests' shared machinery, the `data-agent-*`
 * markup convention, and the protocol projections) moved to `@jini-ai/agentic` on 2026-07-26 — see
 * `packages/agentic/source-map.md` for the extraction and why. This barrel now only exports
 * `CHAT_CAPABILITIES`, the seven `chat.*` verbs that are a genuine chat product surface rather
 * than generic vocabulary, and re-exports `CapabilityDef` from `@jini-ai/agentic` purely for
 * `chat-react`'s older `agent-tools.ts` compatibility shim (which still names it via
 * `@jini-ai/chat-core`) — new code should import `CapabilityDef` from `@jini-ai/agentic` directly.
 */
export { CHAT_CAPABILITIES } from './chat-capabilities.js';
export type { CapabilityDef, CapabilityInputSchema, CapabilityRisk } from '@jini-ai/agentic';
