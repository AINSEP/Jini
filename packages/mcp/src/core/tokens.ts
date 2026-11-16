import { describeErrorForLog } from '@jini-ai/core';
import type { Clock } from "@jini-ai/core/primitives";
/**
 * @module @jini-ai/mcp/core/tokens
 * Persistent, 0600-guarded OAuth-token store for remote MCP servers, keyed by
 * server id, with expiry checks. The durable counterpart to `oauth`'s live flow.
 * Part of the MCP `core` kernel; depends on no sibling subdirectory.
 */
// Persistent OAuth-token storage for external HTTP / SSE MCP servers.
//
// The daemon owns the OAuth flow end-to-end so the user never needs a
// transient `localhost:<port>` listener (the killer of cloud deployments)
// and so a token survives across agent turns. Tokens are written to
// `<dataDir>/mcp-tokens.json` keyed by McpServerConfig.id, with the same
// atomic write + per-dataDir mutex pattern the rest of the runtime uses.
//
// File mode: owner-only (0600) from the very first byte, via
// `writeFileAtomicAsync` (CR-006 / SEC-RB-002) — NOT a post-rename chmod.
// The previous chmod-after-rename approach left a window where the file
// briefly existed with default (potentially world/group-readable)
// permissions, and silently continued persisting the token when chmod
// failed for any reason other than ENOTSUP/EPERM, which is not a
// fail-closed guarantee. `writeFileAtomicAsync` creates the file with mode
// 0600 atomically at creation and fails closed (removing the temp file and
// throwing) if a POSIX platform did not honor that mode; it skips
// verification on `win32`, which has no POSIX permission-bit model.

import { createHash } from 'node:crypto';
import path from 'node:path';
import { defaultMcpSecretFilesystem, type McpConfigFilesystemPort } from './config.js';

/**
 * Stored OAuth token for a single MCP server. Mirrors the relevant subset
 * of an OAuth 2.0 token-endpoint response (RFC 6749 §5.1), plus the OAuth
 * client context the original authorization-code exchange used. Refresh
 * tokens are bound (RFC 6749 §6) to the client that received them, so we
 * have to refresh against the same `client_id` / `redirect_uri` pair —
 * persisting the context here is what lets us do that without re-running
 * authorization.
 */
export interface StoredMcpToken {
  /** The bearer token to send as `Authorization: Bearer …`. */
  accessToken: string;
  /** Refresh token (RFC 6749 §6) if the auth server issued one. */
  refreshToken?: string;
  /** Absolute epoch ms at which `accessToken` expires. Optional — some
   * providers never expire. */
  expiresAt?: number;
  /** RFC 6749 §5.1 token_type. Almost always `Bearer`. */
  tokenType: string;
  /** Space-separated scopes granted (verbatim from the token response). */
  scope?: string;
  /** Wall-clock epoch ms when this record was first persisted. */
  savedAt: number;
  /** Token endpoint that issued this token; reused verbatim for refresh. */
  tokenEndpoint?: string;
  /** Client id that obtained the refresh token. */
  clientId?: string;
  /** Confidential-client secret, if the upstream issued one. */
  clientSecret?: string;
  /** Authorization-server issuer, used to look the cached client back up. */
  authServerIssuer?: string;
  /** Redirect URI registered with the client at authorization time. */
  redirectUri?: string;
  /** RFC 8707 resource indicator the original token was scoped to. */
  resourceUrl?: string;
}

export interface McpTokensFile {
  /** keyed by McpServerConfig.id */
  servers: Record<string, StoredMcpToken>;
}

/** Injectable store boundaries; the default uses the Node filesystem. The clock is a required argument. */
export interface McpTokenStoreOptions { filesystem?: McpConfigFilesystemPort; }

const EMPTY: McpTokensFile = { servers: {} };

function tokensFile(dataDir: string): string {
  return path.join(dataDir, 'mcp-tokens.json');
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

/** Coerce a freeform JSON blob into the typed shape, dropping anything that
 * doesn't deserialize cleanly. Used both at read time and as a defensive
 * pass when third-party tooling has hand-edited the file. */
export function sanitizeTokensFile({ raw, clock }: { raw: unknown; clock: Clock }, _optional = {}): McpTokensFile {
  if (!isPlainObject(raw)) return { servers: {} };
  const servers = raw.servers;
  if (!isPlainObject(servers)) return { servers: {} };
  const out: Record<string, StoredMcpToken> = {};
  for (const [id, value] of Object.entries(servers)) {
    // Prototype-polluting keys are never copied; neither is a token that fails sanitizing.
    const tok = id === '__proto__' || id === 'constructor' ? undefined : sanitizeToken(value, clock);
    if (tok) out[id] = tok;
  }
  return { servers: out };
}

function trimmedString(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
}

function finiteNumber(raw: unknown): number | undefined {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
}

/** Optional fields copied when they deserialize cleanly, in persisted key order. */
const OPTIONAL_TOKEN_FIELDS: ReadonlyArray<readonly [keyof StoredMcpToken, (raw: unknown) => string | number | undefined]> = [
  ['refreshToken', trimmedString],
  ['scope', trimmedString],
  ['expiresAt', finiteNumber],
  ['tokenEndpoint', trimmedString],
  ['clientId', trimmedString],
  ['clientSecret', trimmedString],
  ['authServerIssuer', trimmedString],
  ['redirectUri', trimmedString],
  ['resourceUrl', trimmedString],
];

function sanitizeToken(raw: unknown, clock: Clock): StoredMcpToken | null {
  if (!isPlainObject(raw)) return null;
  const accessToken = trimmedString(raw.accessToken);
  if (!accessToken) return null;
  const out: StoredMcpToken = {
    accessToken,
    tokenType: trimmedString(raw.tokenType) ?? 'Bearer',
    savedAt: finiteNumber(raw.savedAt) ?? clock.nowMs(),
  };
  for (const [key, read] of OPTIONAL_TOKEN_FIELDS) {
    const value = read(raw[key]);
    if (value !== undefined) Object.assign(out, { [key]: value });
  }
  return out;
}

/**
 * Read and sanitize the MCP token store from `<dataDir>/mcp-tokens.json`.
 * Returns an empty store when the file does not exist or contains invalid JSON.
 * Corrupt text is backed up through the owner-only writer before returning empty,
 * so the next mutation cannot erase the recoverable bytes.
 * @param dataDir The resolved runtime data directory.
 * @returns The sanitized token file, or an empty store after missing-file or backed-up corrupt JSON.
 * @throws On unexpected read errors or a failed backup; the damaged file is left untouched.
 * @complexity O(n) time and space in the token file length, including a backup write on corruption.
 */
export async function readTokensFile({ dataDir, clock }: { dataDir: string; clock: Clock }, options: McpTokenStoreOptions = {}): Promise<McpTokensFile> {
  const filesystem = options.filesystem ?? defaultMcpSecretFilesystem;
  let raw: string | undefined;
  try {
    raw = await filesystem.readText({ filePath: tokensFile(dataDir) });
    return sanitizeTokensFile({ raw: JSON.parse(raw), clock });
  } catch (err: unknown) {
    const e = err as { code?: string; name?: string; message?: string };
    if (e.code === 'ENOENT') return { ...EMPTY, servers: { ...EMPTY.servers } };
    if (e.name === 'SyntaxError' && raw !== undefined) {
      // Different corrupt contents must not overwrite each other's recovery copy.
      const digest = createHash('sha256').update(raw).digest('hex');
      await filesystem.writeSecretText({
        filePath: `${tokensFile(dataDir)}.corrupt-${digest}`,
        contents: raw,
      });
      console.error('[mcp-tokens] Corrupted JSON, returning empty:', describeErrorForLog({ err }));
      return { ...EMPTY, servers: { ...EMPTY.servers } };
    }
    throw err;
  }
}

const writeLocks = new Map<string, Promise<unknown>>();

async function withLock<T>(dataDir: string, fn: () => Promise<T>): Promise<T> {
  const prev = writeLocks.get(dataDir) ?? Promise.resolve();
  const task = prev.catch(() => {}).then(fn);
  writeLocks.set(dataDir, task);
  try {
    return await task;
  } finally {
    if (writeLocks.get(dataDir) === task) writeLocks.delete(dataDir);
  }
}

async function writeTokensFile(
  dataDir: string,
  next: McpTokensFile,
  options: McpTokenStoreOptions,
): Promise<McpTokensFile> {
  const file = tokensFile(dataDir);
  // Bearer tokens can hand someone posting-as-you against the upstream MCP,
  // so the file is created with owner-only (0600) permissions from the
  // first byte and the write fails closed if that can't be guaranteed on a
  // POSIX platform — see `writeFileAtomicAsync`.
  await (options.filesystem ?? defaultMcpSecretFilesystem).writeSecretText({ filePath: file, contents: JSON.stringify(next, null, 2) });
  return next;
}

/** Get the current token for a given server, or null when none is stored
 * (or the persisted entry is malformed). */
export async function getToken(
  { dataDir, serverId, clock }: { dataDir: string; serverId: string; clock: Clock },
  options: McpTokenStoreOptions = {},
): Promise<StoredMcpToken | null> {
  const file = await readTokensFile({ dataDir, clock }, options);
  return Object.hasOwn(file.servers, serverId) ? file.servers[serverId]! : null;
}

/** Atomically merge a new token for `serverId` into the tokens file. */
export async function setToken(
  { dataDir, serverId, token, clock }: { dataDir: string; serverId: string; token: StoredMcpToken; clock: Clock },
  options: McpTokenStoreOptions = {},
): Promise<void> {
  await withLock(dataDir, async () => {
    const file = await readTokensFile({ dataDir, clock }, options);
    file.servers[serverId] = token;
    await writeTokensFile(dataDir, file, options);
  });
}

/** Atomically delete the stored token for `serverId`. No-op when absent. */
export async function clearToken(
  { dataDir, serverId, clock }: { dataDir: string; serverId: string; clock: Clock },
  options: McpTokenStoreOptions = {},
): Promise<void> {
  await withLock(dataDir, async () => {
    const file = await readTokensFile({ dataDir, clock }, options);
    if (!(serverId in file.servers)) return;
    delete file.servers[serverId];
    await writeTokensFile(dataDir, file, options);
  });
}

/** Bulk read used by the spawn pipeline so we make one disk hit per spawn,
 * not one per server. */
export async function readAllTokens(
  { dataDir, clock }: { dataDir: string; clock: Clock },
  options: McpTokenStoreOptions = {},
): Promise<Record<string, StoredMcpToken>> {
  const file = await readTokensFile({ dataDir, clock }, options);
  return file.servers;
}

/** True when the stored token is past its `expiresAt` (or within `skew`
 * milliseconds of expiring). Returns false when no `expiresAt` is recorded
 * — many providers issue non-expiring tokens. */
export function isTokenExpired(
  { token, clock }: { token: StoredMcpToken; clock: Clock },
  { now = clock.nowMs(), skew = 30_000 }: { now?: number; skew?: number } = {},
): boolean {
  if (typeof token.expiresAt !== 'number') return false;
  return token.expiresAt - skew <= now;
}
