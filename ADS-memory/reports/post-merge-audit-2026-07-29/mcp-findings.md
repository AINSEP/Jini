# packages/mcp — post-merge audit findings to verify and fix

Source: independent OpenAI Codex (gpt-5.6-sol, high reasoning) peer review of the production-source
diff for `packages/mcp` between `9cb4ffc50` (base) and `085c4799a` (merge of
`feat/agentic-capability-layer` into `main`). None of these have been independently re-verified by
a human or another model yet — treat every one as a hypothesis to confirm against current source,
not a given fact. This is the smallest of the four queued packages (1 blocking finding); Codex
separately confirmed the auth-propagation path is clean (every production daemon request in
`packages/mcp/src` goes through `daemonCallOptions(ctx)`, including the new catalog tools) and found
no authentication bypass or credential leak — that's already-checked-clean territory, don't re-audit
it from scratch, just verify the one finding below and the two non-blocking notes.

## BLOCKING

1. **Schema-validator exceptions escape `handleToolCall` — `tool-protocol.ts:160`.**
   Validation occurs before the `try` at line 164. `@cfworker/json-schema` throws for unsupported
   JavaScript values instead of returning `{valid:false}`. Reproduced with an optional property
   explicitly set to `undefined`:

   ```
   explicit-undefined REJECTED Instances of "undefined" type are not supported.
   ```

   This contradicts the documented guarantee that schema violations produce an MCP `{isError:true}`
   result rather than throwing. Valid JSON-RPC cannot encode `undefined` directly, but the exported
   `handleToolCall` API accepts `Record<string, unknown>` and is usable directly or through an
   injected server implementation, so this is a real reachable gap, not purely theoretical. Fix:
   move validator creation/execution inside the error boundary and translate validator throws into
   a sanitized error result, matching the existing unknown-tool-name / thrown-error handling shape.

## NON-BLOCKING (fix only if small/obviously correct; otherwise just note in your report)

- `tool-catalog-tools.ts:41` declares `limit` as any number, despite describing an integer range of
  1–25. Reproduced: MCP validation accepted `0`, `-1`, `1.5`, and `26`; the HTTP route subsequently
  rejects `0`/`1.5` and clamps `26` — so the two layers disagree. Use `type: 'integer'`,
  `minimum: 1`, and likely `maximum: 25` in the schema.
- `server/index.ts:15` doesn't re-export the new catalog tool definitions. Because the package
  exports only `"."` and `"./bin"`, a custom `createMcpToolServer` consumer can't reuse
  `searchToolsTool`, `describeToolTool`, or `TOOL_CATALOG_TOOLS`. Export them if the "ready to pass"
  comment on that line is meant to denote real public API.

## What to do

For the blocking finding: read the actual current source at `tool-protocol.ts:160` and confirm or
refute it yourself, independently — don't just trust the description above. If it's a false
positive, say exactly why and don't change the code. If it's real: write a FAILING TEST FIRST that
reproduces it (in the relevant existing test file, following that file's own conventions), confirm
it fails against current unfixed code, THEN implement the minimal correct fix, THEN confirm the new
test passes and the package's full test suite has zero regressions. No fix without a preceding red
test. Do the same verify-first discipline for the two non-blocking notes even though you're not
obligated to fix them.

Full working conventions, branch naming, and report format are in the top-level task prompt you
were given alongside a pointer to this file — follow those.
