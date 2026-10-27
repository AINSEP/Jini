import { openWithPassphrase, sealWithPassphrase } from "@jini-ai/platform/secrets";
import { isCopyableKind } from "@jini-ai/platform/secrets/credential-sets";
import { VAULT_KINDS, type VaultKind, type VaultMeta, type VaultOptions, type VaultSummary } from "@jini-ai/platform/secrets/credential-sets/contracts";
import { ownerContext, type OwnerPutInput, type OwnerStoreService } from "./service.js";

type BackupHint = Pick<VaultSummary, "last4" | "tokenLength">;
type BackupEntry = Required<Pick<OwnerPutInput, "id" | "kind" | "ownerKey" | "binding" | "provider" | "label" | "isDefault">>
  & BackupHint & { meta: VaultMeta; payload: VaultMeta | null };
/** A pending target cleanup: the copy it tracks outlives any restore, so the record must too. */
type BackupRevocation = { entryId: string; consumerId: string; workspaceId: string; attempts: number; updatedAt: string };
type BackupSnapshot = { entries: BackupEntry[]; revocations: BackupRevocation[] };
const INVALID_BACKUP = "invalid-backup";
/** Version 1 had no cleanup records, so it cannot show whether a revoked copy is still on a site. */
const BACKUP_VERSION = 2;
const ENTRY_FIELDS = ["id", "kind", "ownerKey", "binding", "provider", "label", "isDefault", "meta", "payload"];
const HINT_FIELDS = ["last4", "tokenLength"];
const REVOCATION_FIELDS = ["entryId", "consumerId", "workspaceId", "attempts", "updatedAt"];

/** Fixed errors keep recovery diagnostics free of parsed secret values. */
export class OwnerStoreBackupError extends Error {
  readonly code: "invalid-backup" | "not-empty";
  constructor({ code }: { code: OwnerStoreBackupError["code"] }, _options: VaultOptions = {}) {
    super(`Owner store backup: ${code}`);
    this.name = "OwnerStoreBackupError";
    this.code = code;
  }
}

/** Take one consistent logical snapshot and encrypt it with the platform passphrase envelope.
 * No owner key, sealed source envelope, or consumer grants enter the portable document; pending
 * target cleanups do, so a restored store still refuses to delete an entry whose copy may remain.
 * @complexity O(n + payload bytes) reads and bounded platform KDF work; snapshot lives in memory.
 * @example const envelope = await exportOwnerStore({ store, passphrase });
 */
export async function exportOwnerStore({ store, passphrase }: { store: OwnerStoreService; passphrase: string }, _options: VaultOptions = {}): Promise<string> {
  const snapshot = await store.kernel.transaction(async () => {
    const entries: BackupEntry[] = [];
    for (const summary of await store.list({})) {
      const entry = await store.vault.get(summary);
      if (!entry) throw new OwnerStoreBackupError({ code: INVALID_BACKUP });
      entries.push({ id: summary.id, kind: summary.kind, ownerKey: summary.ownerKey, binding: summary.binding,
        provider: summary.provider, label: summary.label, isDefault: summary.isDefault, meta: summary.meta, payload: entry.payload,
        last4: summary.last4, tokenLength: summary.tokenLength });
    }
    const revocations = (await store.pendingRevocations({})).map(row => ({ entryId: row.entry_id, consumerId: row.consumer_id,
      workspaceId: row.workspace_id, attempts: row.attempts, updatedAt: row.updated_at }));
    return { entries, revocations };
  });
  return sealWithPassphrase({ payload: JSON.stringify({ format: "jini-owner-store", version: BACKUP_VERSION, ...snapshot }), passphrase });
}

/** Authenticate and structurally validate before writing, then reuse vault parsing/sealing in
 * one transaction. Any row failure rolls back all rows. Grants remain inactive after restore;
 * pending cleanups are restored with their entries.
 * @throws OwnerStoreBackupError for malformed or version-1 snapshots or a nonempty destination; crypto/vault errors propagate.
 * @complexity O(n + payload bytes) with bounded platform KDF work.
 * @example await restoreOwnerStore({ store, envelope, passphrase });
 */
export async function restoreOwnerStore({ store, envelope, passphrase }: { store: OwnerStoreService; envelope: string; passphrase: string }, _options: VaultOptions = {}): Promise<{ restored: number }> {
  const { entries, revocations } = parseSnapshot({ payload: await openWithPassphrase({ envelope, passphrase }) });
  return store.kernel.transaction(async () => {
    const row = await store.kernel.run(db => db.selectFrom("secrets_vault").select("id").executeTakeFirst());
    const grant = await store.kernel.run(db => db.selectFrom("owner_grants").select("entry_id").executeTakeFirst());
    if (row || grant) throw new OwnerStoreBackupError({ code: "not-empty" });
    // Nondefaults first: explicit false stays non-default, then explicit defaults select their group.
    for (const entry of [...entries].sort((a, b) => Number(a.isDefault) - Number(b.isDefault))) {
      const record = await store.vault.prepare({ ...entry, ...ownerContext(entry), expectedRevision: null });
      // Preserve the host-selected hint without guessing a token field in a structured payload.
      await store.repo.put({ record: { ...record, last4: entry.last4, tokenLength: entry.tokenLength }, expectedRevision: null });
    }
    for (const row of revocations) {
      await store.kernel.run(db => db.insertInto("owner_revocations").values({ entry_id: row.entryId, consumer_id: row.consumerId,
        workspace_id: row.workspaceId, attempts: row.attempts, updated_at: row.updatedAt }).execute());
    }
    return { restored: entries.length };
  });
}

/** Reject unknown versions/duplicate IDs before any destination transaction is entered.
 * Version 1 is refused rather than restored: its missing cleanup records would make deleting an entry
 * look safe while a revoked copy may still sit on a site. No release ever wrote one.
 */
function parseSnapshot({ payload }: { payload: string }): BackupSnapshot {
  let document: unknown;
  try { document = JSON.parse(payload); } catch { throw new OwnerStoreBackupError({ code: INVALID_BACKUP }); }
  if (!isObject(document)) throw new OwnerStoreBackupError({ code: INVALID_BACKUP });
  if (document.format !== "jini-owner-store" || document.version !== BACKUP_VERSION
    || !Array.isArray(document.entries) || !Array.isArray(document.revocations)) {
    throw new OwnerStoreBackupError({ code: INVALID_BACKUP });
  }
  const entries = document.entries.map(parseEntry);
  const ids = new Set(entries.map(entry => entry.id));
  if (ids.size !== entries.length) throw new OwnerStoreBackupError({ code: INVALID_BACKUP });
  const revocations = document.revocations.map(value => parseRevocation({ value, ids }));
  if (new Set(revocations.map(row => JSON.stringify([row.entryId, row.consumerId]))).size !== revocations.length) {
    throw new OwnerStoreBackupError({ code: INVALID_BACKUP });
  }
  return { entries, revocations };
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
