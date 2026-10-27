import { openWithPassphrase } from "@jini-ai/platform/secrets";
import { isCopyableKind } from "@jini-ai/platform/secrets/credential-sets";
import { VAULT_KINDS, type VaultKind, type VaultOptions, type VaultSummary } from "@jini-ai/platform/secrets/credential-sets/contracts";
import type { LegacyOwnerEntry, LegacyOwnerSnapshot } from "./legacy.js";

type BackupHint = Pick<VaultSummary, "last4" | "tokenLength">;
type BackupEntry = LegacyOwnerEntry & BackupHint;
/** A pending target cleanup: the site may still hold the revoked copy, so the importer reports it. */
type BackupRevocation = { entryId: string; consumerId: string; workspaceId: string; attempts: number; updatedAt: string };
/** An active grant: its entry was synced to a site, which keeps that copy.
 * workspaceId is the one destination it was bound to (null before its first sync).
 */
type BackupGrant = { entryId: string; consumerId: string; workspaceId: string | null; createdAt: string };
/** unreconciled: entry IDs whose copies may sit at destinations no record names (validated, not returned). */
type BackupSnapshot = { entries: BackupEntry[]; grants: BackupGrant[]; revocations: BackupRevocation[]; unreconciled: string[] };
const INVALID_BACKUP = "invalid-backup";
/** Version 1 had no cleanup records, so it cannot show whether a revoked copy is still on a site. */
const BACKUP_VERSION = 2;
/** Written by published @jini-ai/db 0.6.12: entries only, with no grants, destinations or cleanup records. */
const LEGACY_BACKUP_VERSION = 1;
const ENTRY_FIELDS = ["id", "kind", "ownerKey", "binding", "provider", "label", "isDefault", "meta", "payload"];
const HINT_FIELDS = ["last4", "tokenLength"];
const REVOCATION_FIELDS = ["entryId", "consumerId", "workspaceId", "attempts", "updatedAt"];
const GRANT_FIELDS = ["entryId", "consumerId", "workspaceId", "createdAt"];

/** Fixed errors keep recovery diagnostics free of parsed secret values. */
export class OwnerStoreBackupError extends Error {
  readonly code: "invalid-backup";
  constructor({ code }: { code: OwnerStoreBackupError["code"] }, _options: VaultOptions = {}) {
    super(`Owner store backup: ${code}`);
    this.name = "OwnerStoreBackupError";
    this.code = code;
  }
}

/** Authenticate, then structurally validate a legacy owner backup (v1 or v2) without writing anything.
 * The importer, not this decoder, decides what reaches a project. Validation is unchanged from the
 * old restore: unknown versions, duplicate IDs, malformed grants/cleanups and hint-policy breaks all
 * fail as `invalid-backup` before any caller sees an entry.
 * @throws OwnerStoreBackupError for malformed snapshots; passphrase/envelope errors propagate.
 * @complexity O(n + payload bytes) with bounded platform KDF work.
 * @example const { entries, grants } = await readLegacyOwnerBackup({ envelope, passphrase });
 */
export async function readLegacyOwnerBackup({ envelope, passphrase }: { envelope: string; passphrase: string }, _options: VaultOptions = {}): Promise<LegacyOwnerSnapshot> {
  const snapshot = parseSnapshot({ payload: await openWithPassphrase({ envelope, passphrase }) });
  const destination = (row: { entryId: string; consumerId: string }) => ({ entryId: row.entryId, consumerId: row.consumerId });
  return { entries: snapshot.entries.map(({ last4: _last4, tokenLength: _length, ...entry }) => entry),
    grants: snapshot.grants.map(destination), revocations: snapshot.revocations.map(destination) };
}

/** Reject unknown versions/duplicate IDs before any caller sees an entry.
 * Version 1 (published @jini-ai/db 0.6.12 wrote it) has no grant or cleanup records, so every entry
 * it holds comes back unreconciled: copies may sit on sites no record names.
 */
function parseSnapshot({ payload }: { payload: string }): BackupSnapshot {
  let document: unknown;
  try { document = JSON.parse(payload); } catch { throw new OwnerStoreBackupError({ code: INVALID_BACKUP }); }
  if (!isObject(document) || document.format !== "jini-owner-store") throw new OwnerStoreBackupError({ code: INVALID_BACKUP });
  const entries = arrayOf(document.entries).map(parseEntry);
  const ids = new Set(entries.map(entry => entry.id));
  if (ids.size !== entries.length) throw new OwnerStoreBackupError({ code: INVALID_BACKUP });
  if (document.version === LEGACY_BACKUP_VERSION) return { entries, grants: [], revocations: [], unreconciled: [...ids] };
  if (document.version !== BACKUP_VERSION) throw new OwnerStoreBackupError({ code: INVALID_BACKUP });
  const grants = assertUniquePairs(arrayOf(document.grants).map(value => parseGrant({ value, ids })));
  const revocations = assertUniquePairs(arrayOf(document.revocations).map(value => parseRevocation({ value, ids })));
  const unreconciled = arrayOf(document.unreconciled);
  if (unreconciled.some(id => !ids.has(id as string)) || new Set(unreconciled).size !== unreconciled.length) {
    throw new OwnerStoreBackupError({ code: INVALID_BACKUP });
  }
  return { entries, grants, revocations, unreconciled: unreconciled as string[] };
}

/** A portable list, or the fixed error. */
function arrayOf(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new OwnerStoreBackupError({ code: INVALID_BACKUP });
  return value;
}

/** One row per (entry, consumer), matching each table's primary key; JSON pairs avoid separator collisions. */
function assertUniquePairs<Row extends { entryId: string; consumerId: string }>(rows: Row[]): Row[] {
  if (new Set(rows.map(row => JSON.stringify([row.entryId, row.consumerId]))).size !== rows.length) {
    throw new OwnerStoreBackupError({ code: INVALID_BACKUP });
  }
  return rows;
}

/** Exact fields, a restored entry, a named consumer and a named (or not yet bound) destination. */
function parseGrant({ value, ids }: { value: unknown; ids: Set<string> }): BackupGrant {
  if (!isObject(value) || Object.keys(value).length !== GRANT_FIELDS.length || GRANT_FIELDS.some(key => !Object.hasOwn(value, key))) {
    throw new OwnerStoreBackupError({ code: INVALID_BACKUP });
  }
  const destination = value.workspaceId === null ? [] : [value.workspaceId];
  const named = [value.consumerId, value.createdAt, ...destination].every(item => typeof item === "string" && item.length > 0);
  if (!named || !ids.has(value.entryId as string)) throw new OwnerStoreBackupError({ code: INVALID_BACKUP });
  return value as BackupGrant;
}

/** Exact fields, a restored entry, a named site workspace and at least the one failure that created it. */
function parseRevocation({ value, ids }: { value: unknown; ids: Set<string> }): BackupRevocation {
  if (!isObject(value) || Object.keys(value).length !== REVOCATION_FIELDS.length || REVOCATION_FIELDS.some(key => !Object.hasOwn(value, key))) {
    throw new OwnerStoreBackupError({ code: INVALID_BACKUP });
  }
  const named = [value.consumerId, value.workspaceId, value.updatedAt].every(item => typeof item === "string" && item.length > 0);
  if (!named || !ids.has(value.entryId as string) || !Number.isSafeInteger(value.attempts) || (value.attempts as number) < 1) {
    throw new OwnerStoreBackupError({ code: INVALID_BACKUP });
  }
  return value as BackupRevocation;
}

/** Validate portable field types; the existing vault owns metadata and payload semantics. */
function parseEntry(value: unknown): BackupEntry {
  if (!isObject(value)) throw new OwnerStoreBackupError({ code: INVALID_BACKUP });
  const keys = Object.keys(value);
  if (ENTRY_FIELDS.some(key => !Object.hasOwn(value, key)) || keys.some(key => !ENTRY_FIELDS.includes(key) && !HINT_FIELDS.includes(key))) {
    throw new OwnerStoreBackupError({ code: INVALID_BACKUP });
  }
  assertEntryIdentity(value);
  if (!isObject(value.meta) || !(value.payload === null || isObject(value.payload)) || typeof value.isDefault !== "boolean") {
    throw new OwnerStoreBackupError({ code: INVALID_BACKUP });
  }
  const hint = parseHint({ value });
  assertHintPolicy({ value, hint });
  return { ...value, ...hint } as BackupEntry;
}

/** Older version-1 snapshots omitted both fields; validate supplied hints before any writes. */
function parseHint({ value }: { value: Record<string, unknown> }): BackupHint {
  const hint = { last4: value.last4 ?? null, tokenLength: value.tokenLength ?? null };
  const validLast4 = hint.last4 === null || (typeof hint.last4 === "string" && hint.last4.length === 4);
  const validLength = hint.tokenLength === null || (Number.isSafeInteger(hint.tokenLength) && (hint.tokenLength as number) >= 0);
  if (!validLast4 || !validLength) throw new OwnerStoreBackupError({ code: INVALID_BACKUP });
  return hint as BackupHint;
}

/** Portable hints must retain the vault's short-token and non-token payload privacy rules. */
function assertHintPolicy({ value, hint }: { value: Record<string, unknown>; hint: BackupHint }): void {
  const hintless = value.kind === "database-destination" || value.payload === null;
  if (hintless && (hint.last4 !== null || hint.tokenLength !== null)) throw new OwnerStoreBackupError({ code: INVALID_BACKUP });
  if (hint.last4 !== null && (hint.tokenLength === null || hint.tokenLength < 12)) throw new OwnerStoreBackupError({ code: INVALID_BACKUP });
}

/** Ownership is constrained to the kinds supported by cross-site copying. */
function assertEntryIdentity(value: Record<string, unknown>): void {
  if (![value.id, value.ownerKey, value.label].every(item => typeof item === "string" && item.length > 0)) {
    throw new OwnerStoreBackupError({ code: INVALID_BACKUP });
  }
  if (![value.binding, value.provider].every(item => item === null || typeof item === "string")) throw new OwnerStoreBackupError({ code: INVALID_BACKUP });
  if (!VAULT_KINDS.includes(value.kind as typeof VAULT_KINDS[number]) || !isCopyableKind[value.kind as VaultKind]) {
    throw new OwnerStoreBackupError({ code: INVALID_BACKUP });
  }
}

/** JSON objects only; arrays cannot masquerade as metadata or portable rows. */
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
