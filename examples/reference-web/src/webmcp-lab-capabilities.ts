import type { CapabilityDef } from '@jini/agentic';

/**
 * @module webmcp-lab-capabilities
 *
 * The `webmcp.*` capability manifest for `#/webmcp-lab` — a stress-test fixture, not a product
 * surface. See `WebMcpLab.tsx`'s module doc for the full picture; the short version is that each
 * of these ids is reachable through TWO independent paths at once:
 *
 * 1. **Real WebMCP.** `WebMcpLab.tsx` projects each entry through `@jini/agentic`'s `toWebMcpTool`
 *    and registers the result on `document.modelContext` (via the `@mcp-b/webmcp-polyfill`
 *    polyfill this Chromium build does not natively expose) — the browser-native, no-daemon,
 *    no-principal path the real spec defines.
 * 2. **Jini's own daemon relay.** `examples/reference-web/src/daemon.ts` adds this same array to
 *    `createFrontendControl`'s `capabilities`, so `ToolExecutor` gates one `execute_delegated_tool`
 *    entry per id, and `WebMcpLab.tsx` claims the `webmcp.` prefix in its
 *    `createFrontendSessionBridge({ executors })` call — the path a real coding-agent subprocess
 *    (this environment's agent; it has no browser, so it can never reach path 1) actually uses.
 *
 * Both paths end up calling the exact same underlying action function
 * (`executeWebMcpLabCapability` in `WebMcpLab.tsx`), so there is exactly one implementation of
 * "what `webmcp.add_note` does" — only the gate in front of it differs, which is the honest
 * reflection of `webmcp.ts`'s own module doc: the WebMCP path has no run and no `ToolExecutor`, so
 * `toWebMcpTool`'s confirmation gate is the only thing standing in front of it there, while the
 * daemon path already has one (`FrontendCapabilitySpec.requiresConfirmation`, enforced server-side)
 * before the invocation ever reaches this page.
 *
 * `webmcp.log_event` (a deliberately deep, nested `inputSchema`) is NOT in this manifest —
 * {@link CapabilityDef}'s own `inputSchema` type is intentionally flat (`capability.ts`: "these
 * schemas are flat by construction"), so a genuinely nested schema cannot be expressed as a
 * `CapabilityDef` at all. It is registered directly against `document.modelContext` in
 * `WebMcpLab.tsx`, bypassing this manifest and `toWebMcpTool` entirely — proving the real spec's
 * `inputSchema` (arbitrary `object`) accepts depth Jini's own capability vocabulary does not
 * attempt to model, and that a page may freely mix Jini-backed and page-native WebMCP tools on one
 * `document.modelContext`.
 */
export const WEBMCP_LAB_CAPABILITIES: readonly CapabilityDef[] = [
  {
    id: 'webmcp.list_notes',
    description: 'List every note currently in the WebMCP lab notebook, oldest first.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    risk: 'read',
    surface: 'session',
  },
  {
    id: 'webmcp.add_note',
    description: 'Add one note to the WebMCP lab notebook.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The note text to add.' },
      },
      required: ['text'],
      additionalProperties: false,
    },
    risk: 'write',
    surface: 'session',
  },
  {
    id: 'webmcp.clear_notes',
    description:
      'Permanently delete every note in the WebMCP lab notebook. Irreversible — asks for confirmation first.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    risk: 'write',
    surface: 'session',
    requiresConfirmation: true,
  },
];
