/**
 * @module poc-mcp-ui-official/create-poc-resource
 *
 * PROOF OF CONCEPT — NOT wired into the package's public API (not re-exported from
 * `src/react/index.ts`), and NOT a replacement for the hand-rolled MCP-UI stack
 * (`McpUiSurfaceCard.tsx`, `useMcpUiHost`, `create-mcp-ui-tool-caller.ts`), which this file does
 * not touch.
 *
 * Validates that the REAL, official `@mcp-ui/server` package (not this repo's own reimplementation
 * of the MCP-UI resource shape) can build a `UIResource` end to end, per the owner's decision to
 * evaluate replacing the hand-rolled client with the upstream package. See
 * `poc-mcp-ui-official/__tests__/poc-mcp-ui-official.test.tsx` for the assertions this module
 * exists to feed, and `ADS-memory/` (Tovu side) / this session's final report for the CJS/ESM
 * interop finding that shaped how this is imported (ESM only — `@mcp-ui/client`'s CJS build is
 * broken in 7.1.1; `require('@mcp-ui/client')` throws / returns an empty object depending on Node
 * version. `@mcp-ui/server`'s CJS build works fine in this same version, but this module still
 * uses the ESM entry point for consistency with the client half of this POC).
 */
import { createUIResource, type UIResource } from '@mcp-ui/server';

/** The one concrete example this POC builds: a simple static HTML card. */
export const POC_CARD_URI = 'ui://jini-poc/mcp-ui-official-card';

export const POC_CARD_HTML = [
  '<!doctype html>',
  '<html>',
  '  <body style="font-family: sans-serif; margin: 0; padding: 16px;">',
  '    <h1 data-testid="poc-card-heading">Hello from @mcp-ui/server</h1>',
  '    <p>This card was built by the REAL, official createUIResource(), not the hand-rolled one.</p>',
  '  </body>',
  '</html>',
].join('\n');

/**
 * Builds the one UIResource this POC round-trips: server creates it, the test then feeds its
 * `resource.text` straight to the client's `AppRenderer` as pre-fetched `html` (see the test —
 * `AppRenderer`'s `html` prop skips MCP resource-fetching entirely, which is the right shape for a
 * standalone POC with no live MCP server behind it).
 */
export function createPocUiResource(): UIResource {
  return createUIResource({
    uri: POC_CARD_URI,
    content: { type: 'rawHtml', htmlString: POC_CARD_HTML },
    encoding: 'text',
  });
}
