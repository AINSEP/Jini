import { parse } from 'smol-toml';
import { JINI_MCP_SERVER_KEY } from '../mcp-bridge.js';
import { isRecord } from '../values.js';
import { tomlKey } from './home-config.js';

/** A run with personal MCP off that Codex cannot keep to the bridge alone: refused, never run with a leak. */
export class CodexMcpIsolationError extends Error {}

/** One MCP server another Codex config layer declares. */
interface CodexLayerServer { url: boolean; forcedOn: boolean }

/**
 * Parses one Codex config layer with a real TOML parser, so no spelling (quoted or escaped keys,
 * dotted keys, inline tables, or a `[header]`-shaped line inside a multi-line string or array)
 * hides a server from the check. A file that does not parse is refused: what it declares can't be
 * known, and Codex could not load it either.
 * @complexity O(n) in the file length.
 */
function parseCodexLayer(raw: string, path: string): Record<string, unknown> {
  try {
    return parse(raw);
  } catch {
    throw new CodexMcpIsolationError(`${path} isn't valid TOML, so its MCP servers can't be checked.`);
  }
}

/**
 * The servers one layer's root `mcp_servers` table declares, however spelled: Codex deep-merges
 * layers into one value (codex-rs `config/src/merge.rs` `merge_toml_values`), so a header table, a
 * dotted key and an inline table are the same server to it. A shape that is not a table of server
 * tables is refused. O(s) for s servers.
 */
function codexLayerServers(config: Record<string, unknown>, path: string): Map<string, CodexLayerServer> {
  const servers = new Map<string, CodexLayerServer>();
  const declared = config.mcp_servers;
  if (declared === undefined) return servers;
  if (!isRecord(declared)) throw new CodexMcpIsolationError(`${path} declares MCP servers in a shape that can't be turned off.`);
  for (const [id, server] of Object.entries(declared)) {
    if (!isRecord(server)) throw new CodexMcpIsolationError(`${path} declares the MCP server "${id}" in a shape that can't be turned off.`);
    // Fail closed: anything but a literal `false` (Codex refuses a non-boolean anyway) counts as forcing on.
    servers.set(id, { url: 'url' in server, forcedOn: 'enabled' in server && server.enabled !== false });
  }
  return servers;
}

/**
 * Refuses a layer that trusts a project. Codex loads a project's `.codex/config.toml` only when the
 * config merged below it trusts that project (codex-rs `config/src/loader/mod.rs` L:1098-1125), so
 * with no `projects` table anywhere no project layer, worktree root or root-marker range can add a
 * server. Parsed, so a dotted, inline or escaped spelling is caught too.
 */
function assertTrustsNoProject(config: Record<string, unknown>, path: string): void {
  if ('projects' in config) throw new CodexMcpIsolationError(`${path} trusts projects in a way that can't be removed safely.`);
}

/**
 * The real home config must parse before its line-based rewrite ({@link buildCodexHomeConfigToml})
 * is trusted: a malformed block the rewrite drops would otherwise hide that the line scan misread
 * the file. A missing file (`undefined`) is fine.
 * @throws {@link CodexMcpIsolationError} when it isn't valid TOML.
 */
export function assertCodexHomeConfigParses({ raw, path }: { readonly raw: string | undefined; readonly path: string }): void {
  if (raw !== undefined) parseCodexLayer(raw, path);
}

/**
 * The staged home config, parsed: it must declare no MCP server but the bridge and trust no
 * project. The home rewrite ({@link buildCodexHomeConfigToml}) is line-based so every other byte
 * survives, so a server or trust entry it cannot see (an escaped header, a dotted root key) or a
 * multi-line value a fake header split is refused here instead of staged. O(n) in the config length.
 * @throws {@link CodexMcpIsolationError} when the staged config would not isolate the run.
 */
export function assertStagedHomeIsolated({ homeConfig, path }: { readonly homeConfig: string; readonly path: string }): void {
  const refusal = new CodexMcpIsolationError(`${path} declares MCP servers that can't be removed safely.`);
  let config: Record<string, unknown>;
  try {
    config = parse(homeConfig);
  } catch {
    throw refusal;
  }
  const ids = isRecord(config.mcp_servers) ? Object.keys(config.mcp_servers) : [];
  if (ids.some(id => id !== JINI_MCP_SERVER_KEY)) throw refusal;
  assertTrustsNoProject(config, path);
}

/** Refuses a system server the staged home cannot turn off: `enabled = true` in its own table (merged per key, so it would survive the home's `false`), or one claiming the bridge's own name. */
function assertSystemServerDisableable({ id, server, path }: { id: string; server: CodexLayerServer; path: string }): void {
  if (server.forcedOn) throw new CodexMcpIsolationError(`${path} forces the MCP server "${id}" on.`);
  if (id === JINI_MCP_SERVER_KEY) throw new CodexMcpIsolationError(`${path} redefines the bridge's own "${id}" MCP server.`);
}

/**
 * The home-layer tables that turn off every MCP server the system `config.toml` declares, for a
 * run with personal MCP off. The system layer sits below the user (staged home) layer, and Codex
 * deep-merges layers key by key (codex-rs `config/src/merge.rs` `merge_toml_values`), so
 * `enabled = false` here survives a system table that does not set `enabled` itself; one that does
 * is refused, as is a system trust entry. The placeholder transport matches the real one (a table
 * may not hold both `command` and `url`). Plugin-bundled servers and ChatGPT apps are turned off by
 * the def's `-c features.plugins=false` / `features.apps=false` argv instead, and profile files load
 * only with `--profile`, which no run passes. O(n) in the file length.
 * @throws {@link CodexMcpIsolationError} when the file or one of its servers cannot be turned off.
 */
export function buildCodexSystemServersOffToml({ raw, path }: { readonly raw: string; readonly path: string }): string {
  const config = parseCodexLayer(raw, path);
  assertTrustsNoProject(config, path);
  const placeholders: string[] = [];
  for (const [id, server] of codexLayerServers(config, path)) {
    assertSystemServerDisableable({ id, server, path });
    placeholders.push(`[mcp_servers.${tomlKey(id)}]\nenabled = false\n${server.url ? 'url = "http://127.0.0.1:9/"' : 'command = "jini-disabled-mcp-server"'}\n`);
  }
  return placeholders.join('\n');
}
