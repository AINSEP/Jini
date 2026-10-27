import {
  dirname,
  join,
  resolve,
} from 'node:path';
import { parse } from 'smol-toml';
import { JINI_MCP_SERVER_KEY } from '../mcp-bridge.js';
import { isRecord } from '../values.js';
import { tomlKey } from './home-config.js';

/** Reads one config file; rejects when it is missing. */
export type ReadConfigFile = ({ path }: { readonly path: string }) => Promise<string>;

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
 * The staged home config, parsed: it must declare no MCP server but the bridge. The home rewrite
 * ({@link buildCodexHomeConfigToml}) is line-based so every other byte survives, so a server it
 * cannot see (an escaped header) or a multi-line value a fake header split is refused here
 * instead of staged. O(n) in the config length.
 */
function parseStagedHomeConfig(homeConfig: string, path: string): Record<string, unknown> {
  const refusal = new CodexMcpIsolationError(`${path} declares MCP servers that can't be removed safely.`);
  let config: Record<string, unknown>;
  try {
    config = parse(homeConfig);
  } catch {
    throw refusal;
  }
  const ids = isRecord(config.mcp_servers) ? Object.keys(config.mcp_servers) : [];
  if (ids.some(id => id !== JINI_MCP_SERVER_KEY)) throw refusal;
  return config;
}

/** cwd and its ancestors up to Codex's project root (see {@link codexOtherMcpLayerPaths}), cwd first. O(d) reads. */
async function codexProjectDirs({ cwd, readFile, customRootMarkers }: {
  readonly cwd: string; readonly readFile: ReadConfigFile; readonly customRootMarkers: boolean;
}): Promise<string[]> {
  const ancestors: string[] = [];
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    ancestors.push(dir);
    if (dirname(dir) === dir) break;
  }
  if (customRootMarkers) return ancestors;
  for (const [index, dir] of ancestors.entries()) {
    if (await readFile({ path: join(dir, '.git', 'HEAD') }).then(() => true, () => false)) return ancestors.slice(0, index + 1);
  }
  // No default marker anywhere: Codex treats cwd alone as the project.
  return ancestors.slice(0, 1);
}

/**
 * Codex config files outside the staged `CODEX_HOME` that can add MCP servers. Layer order per
 * codex-rs `config/src/loader/mod.rs` (lowest first): system `/etc/codex/config.toml`, user
 * (the staged home), project `.codex/config.toml` from the project root down to cwd, `-c` flags,
 * then legacy `managed_config.toml` (`/etc/codex` or the home) and macOS MDM above everything.
 * The project root is the nearest ancestor holding `.git/HEAD` (Codex's default marker), else cwd
 * alone; when the user config sets its own `project_root_markers`, every ancestor is listed, since
 * a superset only adds harmless disabled placeholders and a subset would leak. Trust is not
 * checked: Codex keeps untrusted layers as disabled entries. O(d) reads for a cwd d levels deep.
 */
export async function codexOtherMcpLayerPaths({ cwd, sourceHome, readFile, customRootMarkers }: {
  readonly cwd: string; readonly sourceHome: string; readonly readFile: ReadConfigFile; readonly customRootMarkers: boolean;
}, _optional: Record<string, never> = {}): Promise<{ path: string; managed: boolean }[]> {
  const fixed = [
    { path: '/etc/codex/config.toml', managed: false },
    { path: '/etc/codex/managed_config.toml', managed: true },
    { path: join(sourceHome, 'managed_config.toml'), managed: true },
  ];
  const dirs = await codexProjectDirs({ cwd, readFile, customRootMarkers });
  return [...fixed, ...dirs.map(dir => ({ path: join(dir, '.codex', 'config.toml'), managed: false }))];
}

/** Refuses a server the staged home cannot turn off: managed (outranks every override), `enabled = true` in its own table (outranks the home layer), or one claiming the bridge's own name. */
function assertCodexLayerServerDisableable({ id, server, path, managed }: { id: string; server: CodexLayerServer; path: string; managed: boolean }): void {
  if (managed) throw new CodexMcpIsolationError(`the admin-managed ${path} adds the MCP server "${id}".`);
  if (server.forcedOn) throw new CodexMcpIsolationError(`${path} forces the MCP server "${id}" on.`);
  if (id === JINI_MCP_SERVER_KEY) throw new CodexMcpIsolationError(`${path} redefines Tovu's own "${id}" MCP server.`);
}

/**
 * The home-layer tables that turn off every MCP server the other Codex config layers declare,
 * for a run with personal MCP off. Codex deep-merges layers key by key (codex-rs
 * `config/src/merge.rs` `merge_toml_values`), so `enabled = false` here survives a project table
 * that does not set `enabled` itself; one that does is refused. The placeholder transport matches
 * the real one (a table may not hold both `command` and `url`) and keeps the entry valid when
 * Codex skips the layer (an untrusted project). Plugin-bundled servers and ChatGPT apps are
 * turned off by the def's `-c features.plugins=false` / `features.apps=false` argv instead,
 * since only the CLI layer outranks a trusted project. Profile files load only with `--profile`,
 * which no run passes. Unreadable/missing files are skipped. O(total config size).
 * @param homeConfig - The staged home config.toml: refused if it keeps any server but the bridge; its `project_root_markers` decide the project range.
 * @throws {@link CodexMcpIsolationError} when a source cannot be turned off.
 */
export async function buildCodexOtherLayersOffToml({ cwd, sourceHome, readFile, homeConfig }: {
  readonly cwd: string; readonly sourceHome: string; readonly readFile: ReadConfigFile; readonly homeConfig: string;
}, _optional: Record<string, never> = {}): Promise<string> {
  const offIsUrl = new Map<string, boolean>();
  const customRootMarkers = 'project_root_markers' in parseStagedHomeConfig(homeConfig, join(sourceHome, 'config.toml'));
  for (const { path, managed } of await codexOtherMcpLayerPaths({ cwd, sourceHome, readFile, customRootMarkers })) {
    const raw = await readFile({ path }).catch(() => '');
    for (const [id, server] of codexLayerServers(parseCodexLayer(raw, path), path)) {
      assertCodexLayerServerDisableable({ id, server, path, managed });
      offIsUrl.set(id, server.url || offIsUrl.get(id) === true);
    }
  }
  return [...offIsUrl].map(([id, url]) => `[mcp_servers.${tomlKey(id)}]\nenabled = false\n${url ? 'url = "http://127.0.0.1:9/"' : 'command = "jini-disabled-mcp-server"'}\n`).join('\n');
}
