# cms/content-duplication

## Wiring

- `agent-tools.ts`: the `content_duplicate` catalog entry. The host registers the handler and per-resource duplicators in its tool-registration module.
- `derive-available-name.ts`: the numbered-copy naming policy over `@jini-ai/core/naming`. The host injects only `isTaken` (and optional `withSuffix` / `onExhausted`) per call.
