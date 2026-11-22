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

import { realpathSync } from 'node:fs';
import path from 'node:path';
import { afterSettled, orFallbackSync } from '@jini-ai/core/errors/idioms';
import { createConsoleLogger, pathContains, type Logger } from '@jini-ai/core/primitives';
import type { AtomicFileWriterPort } from '@jini-ai/core/contracts/runtime';
import { inferMcpAuthModeForUrl, isPlainObject } from './config-shared.js';
export { inferMcpAuthModeForUrl } from './config-shared.js';
export { buildClaudeMcpJson } from './claude/config.js';
export { buildOpenCodeMcpConfigContent, type OpenCodeConfigBuildOptions } from './opencode/config.js';

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

export interface McpConfigFilesPort {
  readText(args: { filePath: string }): Promise<string>;
  readonly writer: Pick<AtomicFileWriterPort, 'writeText'>;
}

/** Text I/O boundary; secret writes must be atomic and owner-only from creation. */
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
export const MCP_SECRET_WRITE_OPTIONS = { mode: 0o600, verifyOwnerOnly: true, createParent: true } as const;

/** Adapt secret text to the atomic writer with MCP's owner-only policy; writer errors propagate. */
export function writeSecretText(
  { files, filePath, contents }: { files: McpConfigFilesPort; filePath: string; contents: string },
  _optional: Record<string, never> = {},
): Promise<void> {
  return files.writer.writeText({ filePath, content: contents }, MCP_SECRET_WRITE_OPTIONS);
}

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

function isKeepableMapEntry(entry: [string, unknown]): entry is [string, string] {
  const [k, v] = entry;
  if (k === '__proto__' || k === 'constructor' || !k.trim()) return false;
  // Drop empty / whitespace-only values. Persisting them is worse than
  // omitting them: the spawn-time merge treats a present header as
  // "user pinned this", which would block our daemon-issued OAuth
  // Bearer from being injected. The UI also has placeholder fields
  // (e.g. an "Authorization=" template row) the user can leave blank
  // — those should never make it into the saved config.
  return typeof v === 'string' && v.trim() !== '';
}

function sanitizeStringMap(raw: unknown): Record<string, string> | undefined {
  const input = { v: raw };
  if (!isPlainObject(input)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.v).filter(isKeepableMapEntry)) out[k] = v;
  return Object.keys(out).length > 0 ? out : undefined;
}

function nonBlankTrimmed(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
}

function sanitizeStringArray(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw.filter((v): v is string => typeof v === 'string');
  return out.length > 0 ? out : undefined;
}

function sanitizeMcpAuthMode(raw: unknown): McpAuthMode | undefined {
  return typeof raw === 'string' && VALID_AUTH_MODES.has(raw as McpAuthMode)
    ? (raw as McpAuthMode)
    : undefined;
}

/**
 * Validate a single user-supplied entry. Drops invalid fields so a typo in
 * one server doesn't tank the whole config. Returns null when the entry is
 * unsalvageable (no id, or no transport-required fields).
 */
export function sanitizeMcpServer({ raw: value }: { raw: unknown }): McpServerConfig | null {
  const input = { v: value };
  if (!isPlainObject(input)) return null;
  const raw = input.v;
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!SERVER_ID_PATTERN.test(id)) return null;
  const transport = sanitizeTransport(raw.transport);
  if (!transport) return null;
  if (raw.authMode !== undefined && sanitizeMcpAuthMode(raw.authMode) === undefined) return null;

  const next: McpServerConfig = {
    id,
    transport,
    enabled: raw.enabled !== false,
  };
  const label = nonBlankTrimmed(raw.label);
  if (label) next.label = label;
  const fields = transport === 'stdio' ? sanitizeStdioFields(raw) : sanitizeRemoteFields(raw);
  return fields ? { ...next, ...fields } : null;
}

// Absence preserves the legacy stdio default; a supplied invalid discriminator must not
// silently select a different transport or authentication policy.
function sanitizeTransport(raw: unknown): McpTransport | null {
  if (raw === undefined) return 'stdio';
  return typeof raw === 'string' && VALID_TRANSPORTS.has(raw as McpTransport) ? (raw as McpTransport) : null;
}

type TransportFields = Pick<McpServerConfig, 'command' | 'args' | 'env' | 'url' | 'authMode' | 'headers'>;

function sanitizeStdioFields(raw: Record<string, unknown>): TransportFields | null {
  const command = nonBlankTrimmed(raw.command);
  if (!command) return null;
  const out: TransportFields = { command };
  const args = sanitizeStringArray(raw.args);
  if (args) out.args = args;
  const env = sanitizeStringMap(raw.env);
  if (env) out.env = env;
  return out;
}

function sanitizeRemoteFields(raw: Record<string, unknown>): TransportFields | null {
  const rawUrl = nonBlankTrimmed(raw.url);
  if (!rawUrl) return null;
  // Reject anything that isn't an http(s) URL — protects against accidental
  // `file://` / `javascript:` slipping into a config file.
  const parsed = URL.canParse(rawUrl) ? new URL(rawUrl) : null;
  if (parsed?.protocol !== 'http:' && parsed?.protocol !== 'https:') return null;
  const url = parsed.toString();
  const out: TransportFields = { url, authMode: sanitizeMcpAuthMode(raw.authMode) ?? inferMcpAuthModeForUrl({ rawUrl: url }) };
  const headers = sanitizeStringMap(raw.headers);
  if (headers) out.headers = headers;
  return out;
}

/**
 * Coerce and de-duplicate a freeform JSON blob into a valid `McpConfig`.
 * Entries that fail `sanitizeMcpServer` are silently dropped; duplicate ids
 * are kept first-wins. Returns `{ servers: [] }` for any non-object input.
 * @param raw The raw parsed JSON to sanitize.
 * @returns A clean `McpConfig` guaranteed to have only valid, unique server entries.
 */
export function sanitizeMcpConfig({ raw: value }: { raw: unknown }): McpConfig {
  const input = { v: value };
  if (!isPlainObject(input)) return { servers: [] };
  const raw = input.v;
  const list = Array.isArray(raw.servers) ? raw.servers : [];
  const seen = new Set<string>();
  const out: McpServerConfig[] = [];
  for (const entry of list) {
    const ok = sanitizeMcpServer({ raw: entry });
    if (!ok || seen.has(ok.id)) continue; // invalid, or a duplicate id (de-dupe by id)
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
export async function readMcpConfig({ dataDir, files }: { dataDir: string; files: McpConfigFilesPort }, { report = createConsoleLogger({ prefix: '[mcp-config]' }) }: { report?: Pick<Logger, 'error'> } = {}): Promise<McpConfig> {
  try {
    const raw = await files.readText({ filePath: configFile(dataDir) });
    const parsed: unknown = JSON.parse(raw);
    return sanitizeMcpConfig({ raw: parsed });
  } catch (err: unknown) {
    const e = err as { code?: string; name?: string; message?: string };
    if (e.code === 'ENOENT') return { servers: [] };
    if (e.name === 'SyntaxError') {
      const logger = report;
      logger.error({ message: `The MCP config file ${configFile(dataDir)} is not valid JSON; reading it as an empty server list.` }, { error: err });
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
 * (0600) permissions from the very first byte via the injected atomic writer
 * rather than a post-rename chmod (CR-006 / SEC-RB-002).
 * @param dataDir The resolved runtime data directory.
 * @param body The raw config body to sanitize and persist.
 * @returns The sanitized `McpConfig` that was written to disk.
 */
export async function writeMcpConfig(
  { dataDir, body, files }: { dataDir: string; body: unknown; files: McpConfigFilesPort },
  _optional: Record<string, never> = {},
): Promise<McpConfig> {
  const prev = writeLocks.get(dataDir) ?? Promise.resolve();
  const task = afterSettled({ promise: prev }).then(() => doWrite(dataDir, body, files));
  writeLocks.set(dataDir, task);
  try {
    return await task;
  } finally {
    if (writeLocks.get(dataDir) === task) writeLocks.delete(dataDir);
  }
}

async function doWrite(dataDir: string, body: unknown, files: McpConfigFilesPort): Promise<McpConfig> {
  const next = sanitizeMcpConfig({ raw: body });
  await writeSecretText({ files, filePath: configFile(dataDir), contents: JSON.stringify(next, null, 2) });
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
  return orFallbackSync({ work: () => realpathSync.native(p), fallback: undefined, step: 'Resolve MCP config path' }) ?? path.resolve(p);
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
  return pathContains({ root: resolvedProjectsDir, target: resolvedCwd }, { caseSensitive: path.sep !== '\\', separator: path.sep });
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
  return servers
    .filter((s) => s.enabled && s.transport === 'stdio')
    .map((s) => ({
      type: 'stdio',
      name: s.id,
      command: s.command ?? '',
      args: Array.isArray(s.args) ? [...s.args] : [],
      env: Object.entries(s.env ?? {})
        .filter(([, value]) => typeof value === 'string')
        .map(([name, value]) => ({ name, value })),
    }));
}
