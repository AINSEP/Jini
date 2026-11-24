import { buildMcpJsonServerEntry } from "./mcp-bridge.js";

type BridgeInjection = Parameters<typeof buildMcpJsonServerEntry>[0]["options"];

/**
 * The launch entry for the boot-time jini bridge preflight: the real bridge command and env, under
 * the fixed run id `bridge-preflight`, with no callback credential.
 *
 * Initialize needs no callback credential, so the probe never mints a run token. That only holds
 * while the child makes no authenticated daemon call before initialize — and `startupToolIds`
 * makes it fetch those tools' schemas at startup (af84bc598). Left in, every boot logged
 * "jini bridge preflight FAILED (exit=1) jini-mcp: HTTP 401" (2026-10-22). Real runs keep it.
 * @complexity O(t) in the launch env and diagnostic ID bytes.
 */
export function bridgePreflightEntry({ injection }: { readonly injection: BridgeInjection }, _optional = {}) {
  const { startupToolIds: _runScopedOnly, ...preflightOptions } = injection;
  return buildMcpJsonServerEntry({ runId: "bridge-preflight", options: preflightOptions }, {});
}
