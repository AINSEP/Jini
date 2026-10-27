import {
  dirname,
  join,
  resolve,
} from 'node:path';
import { JINI_MCP_SERVER_KEY } from '../mcp-bridge.js';
import { splitTomlDottedKey, TOML_TABLE_HEADER, tomlKey } from './home-config.js';

/** Reads one config file; rejects when it is missing. */
export type ReadConfigFile = ({ path }: { readonly path: string }) => Promise<string>;

/** A run with personal MCP off that Codex cannot keep to the bridge alone: refused, never run with a leak. */
export class CodexMcpIsolationError extends Error {}

/** One `[mcp_servers.<id>]` table another Codex config layer declares. */
interface CodexLayerServer { url: boolean; forcedOn: boolean }

/** {@link scanCodexLayerLine}'s state: the servers found so far and the table the scan is inside. */
interface CodexLayerScan {
  readonly servers: Map<string, CodexLayerServer>;
  table: { kind: 'root' | 'other' | 'bare' } | { kind: 'server'; server: CodexLayerServer; own: boolean };
}

/** Enters a table header: the bare `[mcp_servers]` table, a server's own table or subtable, or anything else. */
function enterCodexLayerTable(scan: CodexLayerScan, segments: readonly string[]): void {
  if (segments[0] !== 'mcp_servers') scan.table = { kind: 'other' };
  else if (segments.length === 1) scan.table = { kind: 'bare' };
  else {
    const id = segments[1]!;
    const server = scan.servers.get(id) ?? { url: false, forcedOn: false };
    scan.servers.set(id, server);
    scan.table = { kind: 'server', server, own: segments.length === 2 };
  }
}

/** Whether a non-header line declares servers inline: a root `mcp_servers` key, or any key in a bare `[mcp_servers]`. */
function declaresInlineServers(scan: CodexLayerScan, key: readonly string[] | null, content: string): boolean {
  if (scan.table.kind === 'root') return key?.[0] === 'mcp_servers';
  return scan.table.kind === 'bare' && content !== '' && !content.startsWith('#');
}

/**
 * A `key = value` line's dotted key, dequoted (`"enabled"`, `'enabled'` and `enabled` are one key),
 * or null when the line holds no `=` outside quotes. An escape sequence in a key is refused: this
 * scan does not decode TOML escapes, and a key it cannot read might be `enabled` or `mcp_servers`.
 * @complexity O(n) in the line length.
 */
function tomlLineKey(content: string, path: string): string[] | null {
  let quote: string | null = null;
  for (let index = 0; index < content.length; index += 1) {
    const ch = content[index]!;
    if (ch === '\\') throw new CodexMcpIsolationError(`${path} uses an escaped TOML key, which can't be checked safely.`);
    if (quote !== null) { if (ch === quote) quote = null; } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '#') return null;
    else if (ch === '=') return splitTomlDottedKey(content.slice(0, index));
  }
  return null;
}

/** One line of another layer's config.toml. Inline shapes cannot be disabled one id at a time, so they refuse. */
function scanCodexLayerLine(scan: CodexLayerScan, line: string, path: string): void {
  const header = TOML_TABLE_HEADER.exec(line);
  if (header?.[1]!.includes('\\')) throw new CodexMcpIsolationError(`${path} uses an escaped TOML key, which can't be checked safely.`);
  if (header) return enterCodexLayerTable(scan, splitTomlDottedKey(header[1]!));
  const content = line.trim();
  const key = tomlLineKey(content, path);
  if (declaresInlineServers(scan, key, content)) {
    throw new CodexMcpIsolationError(`${path} declares MCP servers inline, which can't be turned off one by one.`);
  }
  if (scan.table.kind !== 'server' || !scan.table.own || key?.length !== 1) return;
  if (key[0] === 'url') scan.table.server.url = true;
  // Fail closed: anything but a literal `false` (Codex refuses a non-boolean anyway) counts as forcing on.
  if (key[0] === 'enabled' && !/^false\b/.test(content.slice(content.indexOf('=') + 1).trim())) scan.table.server.forcedOn = true;
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
 * @param homeConfig - The staged home config.toml, whose `project_root_markers` decide the project range.
 * @throws {@link CodexMcpIsolationError} when a source cannot be turned off.
 */
export async function buildCodexOtherLayersOffToml({ cwd, sourceHome, readFile, homeConfig }: {
  readonly cwd: string; readonly sourceHome: string; readonly readFile: ReadConfigFile; readonly homeConfig: string;
}, _optional: Record<string, never> = {}): Promise<string> {
  const offIsUrl = new Map<string, boolean>();
  const customRootMarkers = /^\s*project_root_markers\s*=/m.test(homeConfig);
  for (const { path, managed } of await codexOtherMcpLayerPaths({ cwd, sourceHome, readFile, customRootMarkers })) {
    const raw = await readFile({ path }).catch(() => '');
    const scan: CodexLayerScan = { servers: new Map(), table: { kind: 'root' } };
    for (const line of raw.split('\n')) scanCodexLayerLine(scan, line, path);
    for (const [id, server] of scan.servers) {
      assertCodexLayerServerDisableable({ id, server, path, managed });
      offIsUrl.set(id, server.url || offIsUrl.get(id) === true);
    }
  }
  return [...offIsUrl].map(([id, url]) => `[mcp_servers.${tomlKey(id)}]\nenabled = false\n${url ? 'url = "http://127.0.0.1:9/"' : 'command = "jini-disabled-mcp-server"'}\n`).join('\n');
}
