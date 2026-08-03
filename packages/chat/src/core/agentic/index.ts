/**
 * `@jini-ai/chat/core`'s internal `agentic/` barrel — the chat pane's own capability manifest. Not
 * a public subpath (there is no `"./agentic"` entry in package.json); re-exported from this
 * layer's root `index.ts` instead.
 *
 * Everything that used to live here besides `chat-capabilities.ts` (the framework-free
 * `CapabilityDef` vocabulary, the two shipped manifests' shared machinery, the `data-agent-*`
 * markup convention, and the protocol projections) moved to `@jini-ai/agentic` on 2026-07-26 — see
 * `packages/agentic/source-map.md` for the extraction and why. This barrel now only exports
 * `CHAT_CAPABILITIES`, the seven `chat.*` verbs that are a genuine chat product surface rather
 * than generic vocabulary.
 *
 * The `CapabilityDef` re-export below is a pure back-compatibility alias with **no remaining
 * in-repo consumer**: `chat-react`'s `agent-tools.ts` shim did import it through this package when
 * that comment was written, but now imports it from `@jini-ai/agentic` directly. It stays only so
 * an external `import type { CapabilityDef } from '@jini-ai/chat-core'` (this layer's predecessor
 * package, retired 2026-08-03 — see `../index.ts`'s file doc) keeps compiling; new code should
 * import it from `@jini-ai/agentic`.
 */
export { CHAT_CAPABILITIES } from './chat-capabilities.js';
export type { CapabilityDef, CapabilityInputSchema, CapabilityRisk } from '@jini-ai/agentic';
