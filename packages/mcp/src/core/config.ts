import { isLoopbackHostname } from '@jini-ai/platform/net';
/**
 * @module @jini-ai/mcp/core/config
 * Config schema + on-disk store for the external MCP servers the daemon connects
 * to as a client, plus the per-agent config builders (Claude `.mcp.json`, ACP
 * `mcpServers`, OpenCode) that hand those servers to a launching agent. Part of
 * the MCP `core` kernel; depends on no sibling subdirectory.
 */
// External MCP server configuration storage + spawn-time wiring.
//
// The daemon acts as an MCP CLIENT to one or more external MCP servers
// (image/video generation, GitHub, filesystem, anything the user
// configures). At spawn time we hand those servers to whichever agent is
// being launched (Claude Code via a project-cwd `.mcp.json`, ACP agents via
// the existing `mcpServers` parameter) so the agent surfaces their tools to
// the model.
//
// Storage: <dataDir>/mcp-config.json with shape `{ servers: [...] }`.
//
// We deliberately keep the schema close to Claude Code's `.mcp.json` and
// Cursor's MCP config — those are the de-facto interchange formats — so
// users can copy-paste between tools without translation.

import { readFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { pathContains } from '@jini-ai/core/primitives';
import { writeFileAtomicAsync } from '@jini-ai/platform/fs';

/** Wire-level transport discriminator for how the daemon connects to an external MCP server. */
export type McpTransport = 'stdio' | 'sse' | 'http';
/** Authentication mode for remote MCP servers: `'none'` for local/loopback targets, `'oauth'` for remote ones. */
export type McpAuthMode = 'none' | 'oauth';

/**
 * Persisted configuration for a single external MCP server the user has added.
 * Stored as an element of `McpConfig.servers` in `<dataDir>/mcp-config.json`.
 */
export interface McpServerConfig {
  id: string;
  label?: string;
  transport: McpTransport;
  enabled: boolean;
  authMode?: McpAuthMode;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

/** Top-level on-disk shape of `<dataDir>/mcp-config.json`. */
export interface McpConfig {
  servers: McpServerConfig[];
}

/** Text I/O boundary; secret writes must be atomic and owner-only from creation. */
export interface McpConfigFilesystemPort {
  readText(args: { filePath: string }): Promise<string>;
  writeSecretText(args: { filePath: string; contents: string }): Promise<void>;
}

/** Shared atomic secret persistence (CR-006 / SEC-RB-002).
 * The previous pattern in each of those stores wrote the temp file with
 * default permissions and either never restricted it (config, OAuth client
 * cache) or `chmod(0600)`'d it *after* the atomic rename and silently
 * continued when the chmod failed (tokens) — both leave a window where the
 * file exists world/group-readable, and the latter makes the "protection"
 * advisory rather than enforced. The platform writer instead:
 *
 *   1. Creates the temp file *exclusively* (`wx`) with mode 0600 supplied to
 *      the same `open()`/`writeFile()` call that creates it — POSIX applies
 *      the requested mode atomically at creation time, so there is no
 *      window where the file exists with a broader mode. Creation-mode enforcement
 *      follows the existing prompt-file precedent; the shared writer also reapplies
 *      0600 before checking the mode and flushing the file, never after rename.
 *   2. On POSIX platforms, verifies the on-disk mode actually landed as
 *      owner-only before renaming into place, and fails closed — removing
 *      the temp file and throwing — if it did not (e.g. an unusual umask or
 *      a filesystem that doesn't honor `mode`).
 *   3. Skips that verification on `win32`: Windows has no POSIX permission-
 *      bit model (`mode` there only toggles the read-only attribute), so
 *      there is nothing meaningful to enforce or fail closed on.
 *   4. Flushes file content before rename and the parent directory after it. A directory
 *      flush can fail after replacement; it is reported rather than silently ignored.
 *
 */
const defaultFilesystem: McpConfigFilesystemPort = {
  readText: ({ filePath }) => readFile(filePath, 'utf8'),
  writeSecretText: ({ filePath, contents }) => writeFileAtomicAsync({ filePath, content: contents }, { mode: 0o600, verifyOwnerOnly: true, createParent: true }),
};

const VALID_TRANSPORTS: ReadonlySet<McpTransport> = new Set([
  'stdio',
  'sse',
  'http',
]);
const VALID_AUTH_MODES: ReadonlySet<McpAuthMode> = new Set(['none', 'oauth']);

// Slug rule for server ids. The id flows into agent-facing config files
// (Claude Code's `mcpServers` map keys, ACP `name`) and in some cases into
// argv / env, so we keep it strictly alphanumeric + `-` / `_`.
const SERVER_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

function configFile(dataDir: string): string {
  return path.join(dataDir, 'mcp-config.json');
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function sanitizeStringMap(raw: unknown): Record<string, string> | undefined {
  if (!isPlainObject(raw)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k === '__proto__' || k === 'constructor') continue;
    if (!k.trim()) continue;
    if (typeof v !== 'string') continue;
    // Drop empty / whitespace-only values. Persisting them is worse than
    // omitting them: the spawn-time merge treats a present header as
    // "user pinned this", which would block our daemon-issued OAuth
    // Bearer from being injected. The UI also has placeholder fields
    // (e.g. an "Authorization=" template row) the user can leave blank
    // — those should never make it into the saved config.
    if (v.trim() === '') continue;
    out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeStringArray(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw.filter((v): v is string => typeof v === 'string');
  return out.length > 0 ? out : undefined;
}

// The shared classifier receives the URL parser's canonical hostname; IPv4-mapped
// IPv6 is deliberately not a loopback exception for default authentication.
/**
 * Infer the appropriate `McpAuthMode` for a given server URL.
 * Returns `'none'` for loopback targets (localhost, 127.x.x.x, ::1)
 * and `'oauth'` for everything else, including when `rawUrl` is absent or unparseable.
 * @param rawUrl The server URL string to inspect, if any.
 * @returns The inferred `McpAuthMode`.
 */
export function inferMcpAuthModeForUrl({ rawUrl }: { rawUrl: string | undefined }): McpAuthMode {
  if (!rawUrl) return 'oauth';
  try {
    return isLoopbackHostname({ hostname: new URL(rawUrl).hostname }) ? 'none' : 'oauth';
  } catch {
    return 'oauth';
  }
}

function sanitizeMcpAuthMode(raw: unknown): McpAuthMode | undefined {
  return typeof raw === 'string' && VALID_AUTH_MODES.has(raw as McpAuthMode)
    ? (raw as McpAuthMode)
    : undefined;
}

// Only ever invoked for http/sse servers (the callers gate on transport), so
// there is no stdio short-circuit here — the token merge just needs the
// effective auth mode for a remote server.
function effectiveMcpAuthMode(server: McpServerConfig): McpAuthMode {
  return server.authMode ?? inferMcpAuthModeForUrl({ rawUrl: server.url });
}

/**
 * Validate a single user-supplied entry. Drops invalid fields so a typo in
 * one server doesn't tank the whole config. Returns null when the entry is
 * unsalvageable (no id, or no transport-required fields).
 */
export function sanitizeMcpServer({ raw }: { raw: unknown }): McpServerConfig | null {
  if (!isPlainObject(raw)) return null;
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!SERVER_ID_PATTERN.test(id)) return null;
  // Absence preserves the legacy stdio default; a supplied invalid discriminator must not
  // silently select a different transport or authentication policy.
  if (raw.transport !== undefined && typeof raw.transport !== 'string') return null;
  const transport = raw.transport === undefined ? 'stdio' : (raw.transport as McpTransport);
  if (!VALID_TRANSPORTS.has(transport)) return null;
  if (raw.authMode !== undefined && sanitizeMcpAuthMode(raw.authMode) === undefined) return null;

  const next: McpServerConfig = {
    id,
    transport,
    enabled: raw.enabled !== false,
  };
  if (typeof raw.label === 'string' && raw.label.trim()) {
    next.label = raw.label.trim();
  }

  if (transport === 'stdio') {
    if (typeof raw.command !== 'string' || !raw.command.trim()) return null;
    next.command = raw.command.trim();
    const args = sanitizeStringArray(raw.args);
    if (args) next.args = args;
    const env = sanitizeStringMap(raw.env);
    if (env) next.env = env;
  } else {
    if (typeof raw.url !== 'string' || !raw.url.trim()) return null;
    // Reject anything that isn't an http(s) URL — protects against accidental
    // `file://` / `javascript:` slipping into a config file.
    let parsed: URL;
    try {
      parsed = new URL(raw.url.trim());
    } catch {
      return null;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    next.url = parsed.toString();
    next.authMode = sanitizeMcpAuthMode(raw.authMode) ?? inferMcpAuthModeForUrl({ rawUrl: next.url });
    const headers = sanitizeStringMap(raw.headers);
    if (headers) next.headers = headers;
  }
  return next;
}

/**
 * Coerce and de-duplicate a freeform JSON blob into a valid `McpConfig`.
 * Entries that fail `sanitizeMcpServer` are silently dropped; duplicate ids
 * are kept first-wins. Returns `{ servers: [] }` for any non-object input.
 * @param raw The raw parsed JSON to sanitize.
 * @returns A clean `McpConfig` guaranteed to have only valid, unique server entries.
 */
export function sanitizeMcpConfig({ raw }: { raw: unknown }): McpConfig {
  if (!isPlainObject(raw)) return { servers: [] };
  const list = Array.isArray(raw.servers) ? raw.servers : [];
  const seen = new Set<string>();
  const out: McpServerConfig[] = [];
  for (const entry of list) {
    const ok = sanitizeMcpServer({ raw: entry });
    if (!ok) continue;
    if (seen.has(ok.id)) continue; // de-dupe by id
    seen.add(ok.id);
    out.push(ok);
  }
  return { servers: out };
}

/**
 * Read and sanitize the MCP config from `<dataDir>/mcp-config.json`.
 * Returns `{ servers: [] }` when the file does not exist or contains invalid JSON.
 * @param dataDir The resolved runtime data directory.
 * @returns The sanitized `McpConfig`, never rejects on missing-file or corrupt-JSON.
 */
export async function readMcpConfig({ dataDir }: { dataDir: string }, { filesystem = defaultFilesystem }: { filesystem?: McpConfigFilesystemPort } = {}): Promise<McpConfig> {
  try {
    const raw = await filesystem.readText({ filePath: configFile(dataDir) });
    const parsed: unknown = JSON.parse(raw);
    return sanitizeMcpConfig({ raw: parsed });
  } catch (err: unknown) {
    const e = err as { code?: string; name?: string; message?: string };
    if (e.code === 'ENOENT') return { servers: [] };
    if (e.name === 'SyntaxError') {
      console.error('[mcp-config] Corrupted JSON, returning empty:', e.message);
      return { servers: [] };
    }
    throw err;
  }
}

const writeLocks = new Map<string, Promise<unknown>>();

/**
 * Sanitize and atomically write the MCP config to `<dataDir>/mcp-config.json`.
 * Uses a per-`dataDir` promise-chain mutex so concurrent writes serialize
 * instead of racing. The body is sanitized through `sanitizeMcpConfig` before
 * being written. This file may carry environment variables and
 * `Authorization` header values (API keys, bearer tokens — see
 * `McpServerConfig.env`/`.headers`), so it is written with owner-only
 * (0600) permissions from the very first byte via `writeFileAtomicAsync`
 * rather than a post-rename chmod (CR-006 / SEC-RB-002).
 * @param dataDir The resolved runtime data directory.
 * @param body The raw config body to sanitize and persist.
 * @returns The sanitized `McpConfig` that was written to disk.
 */
export async function writeMcpConfig(
  { dataDir, body }: { dataDir: string; body: unknown },
  { filesystem = defaultFilesystem }: { filesystem?: McpConfigFilesystemPort } = {},
): Promise<McpConfig> {
  const prev = writeLocks.get(dataDir) ?? Promise.resolve();
  const task = prev.catch(() => {}).then(() => doWrite(dataDir, body, filesystem));
  writeLocks.set(dataDir, task);
  try {
    return await task;
  } finally {
    if (writeLocks.get(dataDir) === task) writeLocks.delete(dataDir);
  }
}

async function doWrite(dataDir: string, body: unknown, filesystem: McpConfigFilesystemPort): Promise<McpConfig> {
  const next = sanitizeMcpConfig({ raw: body });
  await filesystem.writeSecretText({ filePath: configFile(dataDir), contents: JSON.stringify(next, null, 2) });
  return next;
}

// ───────────────────────────────────────────────────────────────────────
// Spawn-time wiring helpers.
// ───────────────────────────────────────────────────────────────────────

/**
 * Resolve `p` to its real (symlink-free) path when it exists on disk;
 * falls back to lexical `path.resolve` (still normalizing `..`/`.`
 * segments) when it does not exist yet, or the platform can't resolve it.
 */
function resolveRealOrLexical({ filePath: p }: { filePath: string }): string {
  try {
    return realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
}

/**
 * True when `cwd` is a daemon-managed project directory under `projectsDir`
 * (= safe to write `.mcp.json` into without risk of clobbering a user-owned
 * file). Git-linked projects whose cwd points at the user's own repo, and
 * the no-project fallback that resolves to the project root, both return false
 * — the daemon must NOT write external-MCP config into either of those.
 *
 * Both `cwd` and `projectsDir` are realpath-resolved before the containment
 * check (falling back to lexical `path.resolve` normalization for a path
 * that doesn't exist on disk yet), and containment is decided with
 * `@jini-ai/core/primitives`' separator-aware `pathContains` rather than a raw
 * string-prefix check — a `..`-containing path or a symlinked descendant
 * can defeat a plain `startsWith` (CR-006 / SEC-RB-011).
 */
export function isManagedProjectCwd(
  { cwd, projectsDir }: { cwd: string | null | undefined; projectsDir: string },
  { resolvePath = resolveRealOrLexical }: { resolvePath?: (args: { filePath: string }) => string } = {},
): boolean {
  if (!cwd || typeof cwd !== 'string') return false;
  if (typeof projectsDir !== 'string' || projectsDir.length === 0) return false;
  const resolvedProjectsDir = resolvePath({ filePath: projectsDir });
  const resolvedCwd = resolvePath({ filePath: cwd });
  if (resolvedCwd === resolvedProjectsDir) return false; // projects root, not a project
  return pathContains({ root: resolvedProjectsDir, target: resolvedCwd }, { caseSensitive: path.sep !== '\\', separator: path.sep === '\\' ? '\\' : '/' });
}

/**
 * Project-cwd `.mcp.json` shape that Claude Code auto-loads on spawn (the
 * same format Claude Desktop and Cursor use). Returns null when the user
 * has no enabled servers — in that case the caller should NOT write the
 * file (and should clean up any stale one).
 *
 * `tokens` is an optional map of `serverId -> bearer access token`, used
 * for HTTP/SSE servers that completed the daemon's web OAuth flow. When a
 * token is present we inject `Authorization: Bearer <token>` into the
 * server's headers — this is what bypasses the per-spawn `mcp-remote`
 * dance and lets Claude Code talk directly to the upstream MCP using
 * pre-authenticated credentials. User-supplied headers always win on
 * conflict so they can pin a specific token if they really want to.
 */
export function buildClaudeMcpJson(
  { servers }: { servers: McpServerConfig[] },
  { tokens = {} }: { tokens?: Record<string, string> } = {},
): unknown | null {
  const enabled = servers.filter((s) => s.enabled);
  if (enabled.length === 0) return null;
  const out: Record<string, Record<string, unknown>> = {};
  for (const s of enabled) {
    if (s.transport === 'stdio') {
      const entry: Record<string, unknown> = { command: s.command };
      if (s.args && s.args.length > 0) entry.args = s.args;
      if (s.env && Object.keys(s.env).length > 0) entry.env = s.env;
      out[s.id] = entry;
    } else {
      const entry: Record<string, unknown> = {
        type: s.transport, // 'sse' | 'http'
        url: s.url,
      };
      const headers = mergeAuthHeader(
        s.headers,
        effectiveMcpAuthMode(s) === 'oauth' ? tokens[s.id] : undefined,
      );
      if (headers && Object.keys(headers).length > 0) entry.headers = headers;
      out[s.id] = entry;
    }
  }
  return { mcpServers: out };
}

/** Build a headers object that includes the daemon-issued bearer token when
 * the user hasn't already supplied a NON-EMPTY Authorization header. A
 * blank Authorization (empty string / whitespace only) is treated as
 * "not pinned" — historically the template UI persisted empty values from
 * unfilled fields, and we never want a blank Authorization to suppress a
 * valid OAuth Bearer (the upstream MCP would refuse the connection and
 * fall back to its in-tool re-auth dance). Real user-pinned values still
 * win so manually-set PATs aren't silently overwritten. */
function mergeAuthHeader(
  existing: Record<string, string> | undefined,
  bearer: string | undefined,
): Record<string, string> | undefined {
  const merged: Record<string, string> = {};
  let userAuth: string | null = null;
  for (const [k, v] of Object.entries(existing ?? {})) {
    if (k.toLowerCase() === 'authorization') {
      if (typeof v === 'string' && v.trim() !== '') {
        userAuth = v;
        merged[k] = v;
      }
      // empty / whitespace authorization is ignored, NOT carried through
      continue;
    }
    merged[k] = v;
  }
  if (bearer && !userAuth) {
    merged['Authorization'] = `Bearer ${bearer}`;
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

/**
 * Convert user-configured external MCP servers into the ACP `mcpServers`
 * shape that stdio-capable ACP agents accept.
 * SSE/HTTP servers are dropped — ACP currently models stdio only.
 */
export interface AcpMcpServer {
  type: 'stdio';
  name: string;
  command: string;
  args: string[];
  env: Array<{ name: string; value: string }>;
}

/**
 * Convert user-configured external MCP servers into the ACP `mcpServers` array.
 * Only stdio servers are included — SSE/HTTP are dropped because ACP currently
 * models stdio only. Returns an empty array when no enabled stdio servers exist.
 * @param servers The full server list from `McpConfig`.
 * @returns ACP-shaped server entries for all enabled stdio servers.
 */
export function buildAcpMcpServers({ servers }: { servers: McpServerConfig[] }): AcpMcpServer[] {
  const enabled = servers.filter((s) => s.enabled && s.transport === 'stdio');
  const out: AcpMcpServer[] = [];
  for (const s of enabled) {
    const envEntries: Array<{ name: string; value: string }> = [];
    if (s.env) {
      for (const [name, value] of Object.entries(s.env)) {
        if (typeof value !== 'string') continue;
        envEntries.push({ name, value });
      }
    }
    out.push({
      type: 'stdio',
      name: s.id,
      command: s.command ?? '',
      args: Array.isArray(s.args) ? [...s.args] : [],
      env: envEntries,
    });
  }
  return out;
}

/**
 * OpenCode merges its config from multiple sources at boot — global
 * `~/.config/opencode/opencode.json`, the `OPENCODE_CONFIG` file path, the
 * project `opencode.json`, and the `OPENCODE_CONFIG_CONTENT` env var (an
 * inline JSON string). The env-var path is what lets a launcher hand servers
 * to a single `opencode run` invocation without writing into the user's
 * global config or leaving a temp file around on crash. We also use the same
 * payload to grant `external_directory` access to launcher-selected absolute
 * paths (project cwd, staged skill dirs, etc.) so headless OpenCode runs do
 * not auto-reject them.
 *
 * Returns `null` when nothing would be emitted — the caller must NOT set
 * `OPENCODE_CONFIG_CONTENT` to `null`/empty in that case, because doing so
 * would override the user's saved global config with an empty object. A
 * null return means "leave the env untouched and let OpenCode read the
 * user's home-dir config as-is."
 *
 * The OAuth Bearer merge mirrors `buildClaudeMcpJson` so a remote MCP
 * server the daemon already authenticated against works the same way for
 * OpenCode users without forcing them to re-authenticate inside OpenCode.
 */
/** Options for `buildOpenCodeMcpConfigContent`. */
export interface OpenCodeConfigBuildOptions {
  /** Access tokens keyed by server id. */
  tokens?: Record<string, string>;
  /** Resolves symlinks for permission allowlists. */
  resolvePath?: (args: { filePath: string }) => string;
  /** Absolute filesystem paths OpenCode's `external_directory` permission should allow. */
  allowedDirectories?: string[];
  /** Additional top-level keys merged into the emitted config object (e.g. `provider`). */
  extraConfig?: Record<string, unknown>;
}

export function buildOpenCodeMcpConfigContent(
  { servers }: { servers: McpServerConfig[] },
  options: OpenCodeConfigBuildOptions = {},
): string | null {
  const tokens = options.tokens ?? {};
  const resolvePath = options.resolvePath ?? (({ filePath }: { filePath: string }) => realpathSync.native(filePath));
  return buildOpenCodeContent(servers, tokens, options, resolvePath);
}

function buildOpenCodeContent(
  servers: McpServerConfig[],
  tokens: Record<string, string>,
  options: OpenCodeConfigBuildOptions,
  resolvePath: (args: { filePath: string }) => string,
): string | null {
  const enabled = servers.filter((s) => s.enabled);
  const mcp: Record<string, Record<string, unknown>> = {};
  for (const s of enabled) {
    if (s.transport === 'stdio') {
      const cmd = typeof s.command === 'string' ? s.command.trim() : '';
      if (!cmd) continue;
      const entry: Record<string, unknown> = {
        type: 'local',
        command: [cmd, ...(Array.isArray(s.args) ? s.args : [])],
      };
      if (s.env && Object.keys(s.env).length > 0) {
        entry.environment = { ...s.env };
      }
      entry.enabled = true;
      mcp[s.id] = entry;
    } else {
      const url = typeof s.url === 'string' ? s.url.trim() : '';
      if (!url) continue;
      const entry: Record<string, unknown> = {
        type: 'remote',
        url: s.url,
      };
      const headers = mergeAuthHeader(
        s.headers,
        effectiveMcpAuthMode(s) === 'oauth' ? tokens[s.id] : undefined,
      );
      if (headers && Object.keys(headers).length > 0) entry.headers = headers;
      entry.enabled = true;
      mcp[s.id] = entry;
    }
  }
  const externalDirectory = buildOpenCodeExternalDirectoryAllowlist(
    options.allowedDirectories, resolvePath,
  );
  const extraConfig = options.extraConfig ?? {};
  if (
    Object.keys(mcp).length === 0 &&
    !externalDirectory &&
    Object.keys(extraConfig).length === 0
  ) return null;

  const config: Record<string, unknown> = { ...extraConfig };
  if (Object.keys(mcp).length > 0) config.mcp = mcp;
  if (externalDirectory) {
    const priorPermission =
      config.permission && typeof config.permission === 'object' && !Array.isArray(config.permission)
        ? config.permission as Record<string, unknown>
        : {};
    config.permission = {
      ...priorPermission,
      external_directory: externalDirectory,
    };
  }
  return JSON.stringify(config);
}

function buildOpenCodeExternalDirectoryAllowlist(
  directories: string[] | undefined,
  resolvePath: (args: { filePath: string }) => string,
): Record<string, 'allow'> | null {
  const normalized = Array.from(
    new Set(
      (directories ?? [])
        .filter((dir) => typeof dir === 'string' && dir.trim().length > 0)
        .filter((dir) => path.isAbsolute(dir))
        .flatMap((dir) => normalizeAllowedDirectoryVariants(dir, resolvePath)),
    ),
  );
  if (normalized.length === 0) return null;

  const allowlist: Record<string, 'allow'> = {};
  for (const dir of normalized) {
    allowlist[dir] = 'allow';
    allowlist[joinPermissionGlob(dir, '*')] = 'allow';
    allowlist[joinPermissionGlob(dir, '**')] = 'allow';
  }
  return allowlist;
}

function normalizeAllowedDirectory(dir: string): string {
  const resolved = path.resolve(dir);
  const root = path.parse(resolved).root;
  if (resolved === root) return root;
  return resolved.replace(/[\\/]+$/, '');
}

function normalizeAllowedDirectoryVariants(dir: string, resolvePath: (args: { filePath: string }) => string): string[] {
  const normalized = normalizeAllowedDirectory(dir);
  let real: string | null = null;
  try {
    real = normalizeAllowedDirectory(resolvePath({ filePath: dir }));
  } catch {
    real = null;
  }
  return real && real !== normalized ? [normalized, real] : [normalized];
}

function joinPermissionGlob(dir: string, suffix: '*' | '**'): string {
  return dir.endsWith(path.sep) ? `${dir}${suffix}` : `${dir}${path.sep}${suffix}`;
}
