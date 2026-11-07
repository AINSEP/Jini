/**
 * @file Public surface of `@jini-ai/server/hosted-mcp`: the opt-in hosted MCP entry.
 * It holds the MCP server store, its OAuth exchange, revocation and the credential vault binding.
 *
 * The entry exists before its contents so the export resolves; each piece arrives with the batch
 * that moves it. It never imports `@jini-ai/server/agent-plugin-host` at runtime: shared records live
 * in this package's `src/contracts/`, re-exported by each entry that needs them.
 */
export {};
