/**
 * @jini/agentic/dom — the browser half of agent control.
 *
 * The one `PageDriver` (see `@jini/agentic`'s `page-driver.ts`) that reads and writes a real DOM
 * subtree. Split into its own entry point, compiled under its own `DOM`-lib `tsconfig.dom.json`,
 * so the rest of this package can stay provably DOM-free — see source-map.md's "The DOM split".
 *
 * `@jini/chat-react` is this package's one in-repo consumer today.
 */
export { createDomPageDriver, currentAgentPage, type DomPageDriverOptions } from './dom-page-driver.js';
