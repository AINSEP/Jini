/**
 * @module providers/oauth-tokens
 *
 * Persistent OAuth token storage: atomic write + per-file in-memory mutex +
 * best-effort `chmod 0600`. Ported from OD's `integrations/xai-tokens.ts`,
 * generalized: the origin hardcoded the on-disk filename (`xai-tokens.json`)
 * and type names (`StoredXAIToken`) for xAI's single-account case. Since a
 * host may want this same single-token-per-provider storage shape for any
 * OAuth+PKCE provider (not just xAI), the file name is now a caller-supplied
 * parameter and the types are provider-neutral. The on-disk layout is still
 * `{ token: ... }` (room for a future multi-account schema without breaking
 * existing files) and the write path is unchanged.
 */
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

/**
 * Stored OAuth token. Mirrors the relevant subset of an OAuth 2.0
 * token-endpoint response (RFC 6749 §5.1). `client_id`, `redirect_uri`, and
 * `issuer` aren't persisted because they're constants in the provider's own
 * `OAuthPkceProviderConfig`.
 */
export interface StoredOAuthToken {
  /** The bearer token to send as `Authorization: Bearer ...`. */
  accessToken: string;
  /** Refresh token (RFC 6749 §6) if the auth server issued one. */
  refreshToken?: string;
  /** Absolute epoch ms at which `accessToken` expires. Optional — some providers never expire. */
  expiresAt?: number;
  /** RFC 6749 §5.1 token_type. Almost always `Bearer`. */
  tokenType: string;
  /** Space-separated scopes granted (verbatim from the token response). */
  scope?: string;
  /** Wall-clock epoch ms when this record was first persisted. */
  savedAt: number;
}

export interface OAuthTokenFile {
  token?: StoredOAuthToken;
}

const EMPTY: OAuthTokenFile = {};

function tokenFilePath(dataDir: string, fileName: string): string {
  return path.join(dataDir, fileName);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

/** Coerces a freeform JSON blob into the typed shape, dropping anything that doesn't deserialize cleanly. Used both at read time and as a defensive pass when third-party tooling has hand-edited the file. */
export function sanitizeOAuthTokenFile({ raw }: { raw: unknown }): OAuthTokenFile {
  if (!isPlainObject(raw)) return {};
  const tok = sanitizeToken(raw.token);
  return tok ? { token: tok } : {};
}

function sanitizeToken(raw: unknown): StoredOAuthToken | null {
  if (!isPlainObject(raw)) return null;
  const accessToken =
    typeof raw.accessToken === 'string' ? raw.accessToken.trim() : '';
  if (!accessToken) return null;
  const tokenType =
    typeof raw.tokenType === 'string' && raw.tokenType.trim()
      ? raw.tokenType.trim()
      : 'Bearer';
  const refreshToken =
    typeof raw.refreshToken === 'string' && raw.refreshToken.trim()
      ? raw.refreshToken.trim()
      : undefined;
  const scope =
    typeof raw.scope === 'string' && raw.scope.trim()
      ? raw.scope.trim()
      : undefined;
  const expiresAt =
    typeof raw.expiresAt === 'number' && Number.isFinite(raw.expiresAt)
      ? raw.expiresAt
      : undefined;
  const savedAt =
    typeof raw.savedAt === 'number' && Number.isFinite(raw.savedAt)
      ? raw.savedAt
      : Date.now();
  const out: StoredOAuthToken = { accessToken, tokenType, savedAt };
  if (refreshToken) out.refreshToken = refreshToken;
  if (scope) out.scope = scope;
  if (expiresAt !== undefined) out.expiresAt = expiresAt;
  return out;
}

export async function readOAuthTokenFile({ dataDir, fileName }: { dataDir: string; fileName: string }): Promise<OAuthTokenFile> {
  try {
    const raw = await readFile(tokenFilePath(dataDir, fileName), 'utf8');
    return sanitizeOAuthTokenFile({ raw: JSON.parse(raw) });
  } catch (err: unknown) {
    const e = err as { code?: string; name?: string; message?: string };
    if (e.code === 'ENOENT') return { ...EMPTY };
    if (e.name === 'SyntaxError') {
      console.error('[oauth-tokens] Corrupted JSON, returning empty:', e.message);
      return { ...EMPTY };
    }
    throw err;
  }
}

const writeLocks = new Map<string, Promise<unknown>>();

async function withLock<T>(lockKey: string, fn: () => Promise<T>): Promise<T> {
  const prev = writeLocks.get(lockKey) ?? Promise.resolve();
  const task = prev.catch(() => {}).then(fn);
  writeLocks.set(lockKey, task);
  try {
    return await task;
  } finally {
    if (writeLocks.get(lockKey) === task) writeLocks.delete(lockKey);
  }
}

async function writeTokenFile(
  dataDir: string,
  fileName: string,
  next: OAuthTokenFile,
): Promise<OAuthTokenFile> {
  const file = tokenFilePath(dataDir, fileName);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = file + '.' + randomBytes(4).toString('hex') + '.tmp';
  await writeFile(tmp, JSON.stringify(next, null, 2), 'utf8');
  await rename(tmp, file);
  // Best-effort lockdown of file mode. A bearer token grants API access on
  // the user's behalf, so restrict to owner-only read/write where the OS
  // supports it.
  try {
    await chmod(file, 0o600);
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    if (e.code !== 'ENOTSUP' && e.code !== 'EPERM') {
      console.warn(
        '[oauth-tokens] could not chmod 0600',
        file,
        e.message ?? err,
      );
    }
  }
  return next;
}

/** Gets the current stored OAuth token for `fileName`, or null when none is stored (or the persisted entry is malformed). */
export async function getStoredOAuthToken({ dataDir, fileName }: { dataDir: string; fileName: string }
): Promise<StoredOAuthToken | null> {
  const file = await readOAuthTokenFile({ dataDir: dataDir, fileName: fileName });
  return file.token ?? null;
}

/** Atomically replaces the stored OAuth token for `fileName`. */
export async function setStoredOAuthToken({ dataDir, fileName, token }: { dataDir: string; fileName: string; token: StoredOAuthToken }
): Promise<void> {
  await withLock(`${dataDir}\0${fileName}`, async () => {
    await writeTokenFile(dataDir, fileName, { token });
  });
}

/** Atomically deletes the stored OAuth token for `fileName`. No-op when absent. */
export async function clearStoredOAuthToken({ dataDir, fileName }: { dataDir: string; fileName: string }): Promise<void> {
  await withLock(`${dataDir}\0${fileName}`, async () => {
    const file = await readOAuthTokenFile({ dataDir: dataDir, fileName: fileName });
    if (!file.token) return;
    await writeTokenFile(dataDir, fileName, {});
  });
}

/** True when the stored token is past its `expiresAt` (or within `skew` milliseconds of expiring). Returns false when no `expiresAt` is recorded — some providers issue non-expiring tokens. */
export function isOAuthTokenExpired({ token }: { token: StoredOAuthToken }, { now = Date.now(), skew = 120_000 }: { now?: number; skew?: number } = {}
): boolean {
  if (typeof token.expiresAt !== 'number') return false;
  return token.expiresAt - skew <= now;
}
