/**
 * @jini-ai/agentic/dom — the browser half of agent control.
 *
 * The one `PageDriver` (see `@jini-ai/agentic`'s `page-driver.ts`) that reads and writes a real DOM
 * subtree. Split into its own entry point, compiled under its own `DOM`-lib `tsconfig.dom.json`,
 * so the rest of this package can stay provably DOM-free — see source-map.md's "The DOM split".
 *
 * `@jini-ai/chat-react` is this package's one in-repo consumer today.
 */
export { createDomPageDriver, currentAgentPage, type DomPageDriverOptions } from './dom-page-driver.js';

/**
 * WebMCP feature detection — moved 2026-07-26 from `@jini-ai/ui`'s `agent-tools/model-context.ts`
 * (plan §8 step 6). See `model-context.ts`'s module doc for why it lives here rather than
 * alongside `../webmcp.ts`'s DOM-free projection.
 */
export {
  getAgentModelContext,
  type AgentModelContextLike,
  type AgentModelContextToolRegistration,
} from './model-context.js';
