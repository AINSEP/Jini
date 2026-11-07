/**
 * @file Public surface of `@jini-ai/server/agent-plugin-host`: the opt-in Agent Plugin host entry.
 * It holds the code that crosses package domains, shows a card, or waits on an exchange: connect,
 * access token, credential save, provisioning, the API connection host, connect orchestration and the
 * executable-tool host. A lower-layer package reaches this code only through its own ports.
 *
 * The entry exists before its contents so the export resolves; each piece arrives with the batch
 * that moves it. It never imports `@jini-ai/server/hosted-mcp` at runtime: shared records live in
 * this package's `src/contracts/`, re-exported by each entry that needs them.
 */
export {};
