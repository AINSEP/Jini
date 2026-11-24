import type { ISODateTime, UUID } from "@jini-ai/core/primitives";

/**
 * @file The `api_keys` record shape and its two ports (ADR-021 / SPEC-006 REQ-08, state.spec §2).
 *
 * Purpose:
 * `@jini-ai/cms/identity` ships nine repo ports and deliberately stops there — its `INFO.md` names
 * API keys as the one identity table left out of that pass. This file is the tenth port, declared
 * HERE rather than in the library because api-key issuance/verification is implemented in this
 * host (`api-key-service.ts`), and a port belongs with the code that consumes it.
 *
 * Architectural role:
 * Interfaces and types only — no logic, mirroring `@jini-ai/cms/identity`'s own `ports.ts`. The
 * two adapters are `repo.memory.ts` (`InMemoryApiKeyRepo`) and `repo.sqlite.ts`
 * (`SqliteApiKeyRepo`) — a real ADR-006 rule-of-two, not a single-adapter port.
 */

/**
 * One issued key. `keyHash` is a digest of the key's SECRET half only; the raw key exists exactly
 * once, in `APIKEY_ISSUE`'s response, and is never stored or logged (INV-05).
 *
 * `prefix` is the key's non-secret half, stored in the clear on purpose: it is the lookup handle
 * that turns verification into one indexed row read plus one hash comparison. Without it, a salted
 * KDF digest (which is not a deterministic function of the key alone) would force a full-table
 * scan hashing every row on every request.
 */
export interface ApiKeyRecord {
  id: UUID;
  workspaceId: UUID;
  /** The bound `kind='api_key'` principal this key authenticates as (REQ-08). */
  principalId: UUID;
  label: string;
  /** Digest of the secret half — see `api-key-secret.ts` for the format and its cost parameters. */
  keyHash: string;
  /** Non-secret lookup handle, e.g. `<host scheme prefix>9f2c1b04d7e5`. Unique per workspace. */
  prefix: string;
  /**
   * The `is_frozen` permission-snapshot policy minted for this key at issuance (F-054-01).
   * `revokeApiKey` retires it with the key so no orphan grant rows survive revocation.
   */
  issuedPolicyId?: UUID;
  createdAt: ISODateTime;
  lastUsedAt?: ISODateTime;
  /** Issuance writes this key even for a non-expiring key, so it may be present and `undefined`. */
  expiresAt?: ISODateTime | undefined;
  revokedAt?: ISODateTime;
}

export interface ApiKeyRepoPort {
  findById(required: { workspaceId: UUID; id: UUID }): Promise<ApiKeyRecord | null>;
  /** The verification path's single row read — see `ApiKeyRecord.prefix` for why this is the seam. */
  findByPrefix(required: { workspaceId: UUID; prefix: string }): Promise<ApiKeyRecord | null>;
  listByPrincipalId(required: { workspaceId: UUID; principalId: UUID }): Promise<ApiKeyRecord[]>;
  save(record: ApiKeyRecord): Promise<void>;
}

/**
 * The hashing seam for api-key secrets, separate from `PasswordHasherPort` because the two hash
 * fundamentally different inputs and are therefore tuned differently — see `api-key-secret.ts`'s
 * header for the entropy argument behind that split.
 *
 * `verify` must be constant-time in the digest comparison and must never throw: a malformed or
 * foreign stored hash resolves `false` (rejected credential), never a 500 and never a bypass.
 */
export interface ApiKeySecretHasherPort {
  hash(required: { secret: string }, optional?: {}): Promise<string>;
  verify(required: { storedHash: string; secret: string }, optional?: {}): Promise<boolean>;
}
