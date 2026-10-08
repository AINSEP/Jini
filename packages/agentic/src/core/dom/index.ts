/**
 * @jini-ai/agentic/dom — the browser half of agent control.
 *
 * The one `PageDriver` (see `@jini-ai/agentic`'s `page-driver.ts`) that reads and writes a real DOM
 * subtree. Split into its own entry point, compiled under its own `DOM`-lib `tsconfig.dom.json`,
 * so the rest of this package stays DOM-free.
 */
export {
  createDomPageDriver,
  currentAgentPage,
  type DomPageDriverRequired,
  type DomPageDriverOptions,
  type DomPageDriverPage,
} from './dom-page-driver.js';

/** Browser WebMCP feature detection. See model-context.ts for why it lives here rather than
 * beside the DOM-free webmcp.ts projection. */
export {
  getAgentModelContext,
  type AgentModelContextLike,
  type ModelContextHostPort,
  type AgentModelContextRegisterToolOptions,
  type AgentModelContextToolRegistration,
} from './model-context.js';
