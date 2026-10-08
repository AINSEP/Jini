/**
 * Internal chat capability barrel, re-exported by chat/core rather than a public ./agentic subpath.
 * CHAT_CAPABILITIES belongs to chat; generic capability vocabulary belongs to @jini-ai/agentic.
 * The type re-exports preserve public compatibility. New code should import vocabulary from its
 * owner, @jini-ai/agentic.
 */
export { CHAT_CAPABILITIES } from './chat-capabilities.js';
export type { CapabilityDef, CapabilityInputSchema, CapabilityRisk } from '@jini-ai/agentic';
