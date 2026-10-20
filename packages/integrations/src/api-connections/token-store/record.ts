/** @file Pure codec between OAuth token sets and vault rows.
 * Exists so every read is checked the same way before a token leaves the store: the OAuth
 * discriminator, the expected connection owner and the token shape. Secrets live only in the
 * sealed payload; the plaintext metadata holds the discriminator, status and lease fields. */
import type { OAuthTokenSet } from "@jini-ai/oauth";
import type { VaultMeta } from "@jini-ai/platform/secrets/credential-sets";
import { OAuthTokenStoreError } from "./errors.js";

/** Marks a vault row (metadata and sealed payload) as an OAuth token record. */
export const OAUTH_TOKEN_RECORD_FORMAT = "oauth-token-set";
const PAYLOAD_VERSION = 1;

/** Who a stored token set belongs to. Every read must match all four ids exactly. */
export interface OAuthConnectionOwner {
  readonly workspaceId: string;
  readonly pluginId: string;
  readonly connectionId: string;
  readonly clientId: string;
}
export type OAuthConnectionStatus = "active" | "reconnect-required";
/** Plaintext (never secret) metadata. The lease fields make refresh exclusive across processes. */
export interface OAuthTokenRecordMeta {
  readonly status: OAuthConnectionStatus;
  readonly leaseHolder: string | null;
  readonly leaseExpiresAtMs: number | null;
}
export interface OAuthTokenPayload {
  readonly generation: number;
  readonly tokens: OAuthTokenSet | null;
}

const META_KEYS = ["credentialFormat", "status", "leaseHolder", "leaseExpiresAtMs"];
const OWNER_KEYS = ["workspaceId", "pluginId", "connectionId", "clientId"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function invalid(): OAuthTokenStoreError {
  return new OAuthTokenStoreError({ code: "invalid-record" });
}

/** Builds the plaintext metadata written next to the sealed payload. */
export function buildRecordMeta({ meta }: { meta: OAuthTokenRecordMeta }): VaultMeta {
  return { credentialFormat: OAUTH_TOKEN_RECORD_FORMAT, status: meta.status,
    leaseHolder: meta.leaseHolder, leaseExpiresAtMs: meta.leaseExpiresAtMs };
}

/** Vault metadata parser for the kind a host stores OAuth tokens under. Register it with
 * `createVaultMetaParsers({}, { parsers: { [kind]: parseOAuthTokenVaultMeta } })`; it refuses any
 * extra key so metadata cannot become a side channel for secrets.
 * @throws OAuthTokenStoreError `invalid-record` on any other shape. */
export function parseOAuthTokenVaultMeta({ meta }: { meta: unknown }): VaultMeta {
  if (!isRecord(meta) || Object.keys(meta).some(key => !META_KEYS.includes(key))) throw invalid();
  return buildRecordMeta({ meta: readRecordMeta({ meta }) });
}

/** Reads the discriminator and lease fields of a stored row. @throws `invalid-record`. */
export function readRecordMeta({ meta }: { meta: unknown }): OAuthTokenRecordMeta {
  if (!isRecord(meta) || meta.credentialFormat !== OAUTH_TOKEN_RECORD_FORMAT) throw invalid();
  const { status, leaseHolder, leaseExpiresAtMs } = meta;
  if (status !== "active" && status !== "reconnect-required") throw invalid();
  if (leaseHolder !== null && typeof leaseHolder !== "string") throw invalid();
  if (leaseExpiresAtMs !== null && !Number.isSafeInteger(leaseExpiresAtMs)) throw invalid();
  return { status, leaseHolder, leaseExpiresAtMs: leaseExpiresAtMs as number | null };
}

/** Builds the sealed payload; the owner and key are sealed with the tokens so a row copied or
 * re-pointed to another connection is refused on read. */
export function buildTokenPayload(
  required: { key: string; owner: OAuthConnectionOwner; generation: number; tokens: OAuthTokenSet | null },
): VaultMeta {
  const { key, owner, generation, tokens } = required;
  return { format: OAUTH_TOKEN_RECORD_FORMAT, version: PAYLOAD_VERSION, key, generation,
    owner: { workspaceId: owner.workspaceId, pluginId: owner.pluginId, connectionId: owner.connectionId, clientId: owner.clientId },
    tokens: tokens === null ? null : { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken,
      tokenType: tokens.tokenType, scopes: [...tokens.scopes], expiresAt: tokens.expiresAt } };
}

function ownerMatches(value: unknown, owner: OAuthConnectionOwner): boolean {
  return isRecord(value) && Object.keys(value).length === OWNER_KEYS.length && OWNER_KEYS.every(name => value[name] === owner[name]);
}
function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === "string");
}
function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

/** Validates a token set before it is written or after it is read. @throws `invalid-record`. */
export function parseTokenSet({ value }: { value: unknown }): OAuthTokenSet {
  if (!isRecord(value)) throw invalid();
  const { accessToken, refreshToken, tokenType, scopes, expiresAt } = value;
  const valid = typeof accessToken === "string" && accessToken.length > 0 && isNullableString(refreshToken) &&
    typeof tokenType === "string" && isStringList(scopes) && isNullableString(expiresAt);
  if (!valid) throw invalid();
  return { accessToken, refreshToken, tokenType, scopes: [...scopes], expiresAt };
}

/** Opens a decrypted payload for one expected key and owner.
 * @throws `owner-mismatch` when it belongs elsewhere, `invalid-record` when malformed. */
export function parseTokenPayload(
  required: { payload: unknown; key: string; owner: OAuthConnectionOwner },
): OAuthTokenPayload {
  const { payload, key, owner } = required;
  if (!isRecord(payload) || payload.format !== OAUTH_TOKEN_RECORD_FORMAT || payload.version !== PAYLOAD_VERSION) throw invalid();
  if (payload.key !== key || !ownerMatches(payload.owner, owner)) throw new OAuthTokenStoreError({ code: "owner-mismatch" });
  if (!Number.isSafeInteger(payload.generation)) throw invalid();
  return { generation: payload.generation as number,
    tokens: payload.tokens === null ? null : parseTokenSet({ value: payload.tokens }) };
}
