import { parse } from 'smol-toml';
import { JINI_MCP_SERVER_KEY } from '../mcp-bridge.js';
import { isRecord } from '../values.js';

/** A run with personal MCP off that Codex cannot keep to the bridge alone: refused, never run with a leak. */
export class CodexMcpIsolationError extends Error {}

/** The user-facing refusal for a {@link CodexMcpIsolationError} reason. */
export function codexIsolationRefusalMessage(reason: string): string {
  return `Codex can't run with 'Your MCP servers' off: ${reason} Turn it on in the assistant settings, or choose Claude.`;
}

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
