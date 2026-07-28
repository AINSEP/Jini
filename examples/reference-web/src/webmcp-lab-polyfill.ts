/**
 * @module webmcp-lab-polyfill
 *
 * Test/demo scaffolding for `#/webmcp-lab` only — NOT a product dependency and NOT imported by
 * anything under `packages/@jini/**`.
 *
 * `#/webmcp-lab` exists to stress-test `@jini/agentic`'s `webmcp.ts` against a spec-conformant
 * `document.modelContext`, but the Playwright-driven Chromium this repo's tooling runs has
 * neither `document.modelContext` nor `navigator.modelContext` — WebMCP is origin-trial gated in
 * real Chrome (Chrome 149–156), not on by default, and this environment has no way to opt in. A
 * real product page must NOT depend on this module: `@jini/agentic`'s `webmcp.ts` deliberately
 * ships no polyfill and no feature-detection of its own (see its module doc — "that detection is
 * deliberately NOT here... a framework binding owns host access"), and loading a polyfill is a
 * page's own decision to make, not the engine's.
 *
 * `@mcp-b/webmcp-polyfill` (https://github.com/WebMCP-org/npm-packages, the `WebMCP-org`/former
 * `MCP-B` community project — a precursor/parallel project to the W3C WebMachineLearning CG spec,
 * not the standards body itself) is a `devDependency` of this example ONLY, added 2026-07-28
 * specifically for this fixture. Its behavior was cross-checked against the primary spec text
 * (https://webmachinelearning.github.io/webmcp/) this same session; concrete divergences found
 * (worth knowing before trusting anything this polyfill does):
 *
 * - `registerTool()` REJECTS a promise for a signal already aborted at call time, matching spec —
 *   but for every OTHER validation failure the spec's own algorithm text describes ("return a
 *   promise rejected with an InvalidStateError DOMException" for an empty/oversized/malformed name,
 *   an empty description, or a duplicate name), this polyfill instead THROWS SYNCHRONOUSLY, before
 *   ever returning a `Promise`. A caller that does `modelContext.registerTool(tool).catch(...)`
 *   rather than `await`ing inside a `try`/`catch` would see an uncaught exception instead of a
 *   handled rejection for exactly these cases.
 * - The duplicate-name case additionally throws a plain `Error` ("Tool already registered: <name>"),
 *   not a `DOMException` named `InvalidStateError` as the spec's algorithm names it — so branching
 *   on `error.name === 'InvalidStateError'` to detect "this name is taken" will not work against
 *   this polyfill, even though the *outcome* (registration refused) matches the spec.
 * - `exposedTo` is declared in this polyfill's own TypeScript types
 *   (`ModelContextRegisterToolOptions.exposedTo`) but is never read anywhere in its runtime
 *   `registerTool()` — it is accepted and silently has no effect. True origin-scoping enforcement
 *   cannot be verified through any same-document polyfill regardless, native or not.
 * - `execute()` is always invoked with a second `client: { requestUserInteraction(callback) }`
 *   argument — a non-standard "MCPB extension", not present in the primary spec's
 *   `ToolExecuteCallback` IDL (`Promise<any> (object input)`, one argument). `@jini/agentic`'s
 *   `toWebMcpTool` returns an `execute` that takes one argument, so the extra argument is simply
 *   ignored — harmless, and further confirmation that Jini's own, separate confirmation gate
 *   (`RequestUserInteraction` in `webmcp.ts`) was the right design, not a gap.
 */
import { initializeWebMCPPolyfill } from '@mcp-b/webmcp-polyfill';

let installed = false;

/**
 * Installs the polyfill once. A no-op if `document.modelContext` already exists — native or
 * already installed — so this never shadows a real implementation.
 */
export function installWebMcpLabPolyfill(): void {
  if (installed) return;
  installed = true;
  initializeWebMCPPolyfill();
}
