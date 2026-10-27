import { openWithPassphrase, sealWithPassphrase } from "@jini-ai/platform/secrets";
import { isCopyableKind } from "@jini-ai/platform/secrets/credential-sets";
import { VAULT_KINDS, type VaultKind, type VaultMeta, type VaultOptions, type VaultSummary } from "@jini-ai/platform/secrets/credential-sets/contracts";
import { ownerContext, type OwnerPutInput, type OwnerStoreService } from "./service.js";

type BackupHint = Pick<VaultSummary, "last4" | "tokenLength">;
type BackupEntry = Required<Pick<OwnerPutInput, "id" | "kind" | "ownerKey" | "binding" | "provider" | "label" | "isDefault">>
  & BackupHint & { meta: VaultMeta; payload: VaultMeta | null };
const INVALID_BACKUP = "invalid-backup";
const ENTRY_FIELDS = ["id", "kind", "ownerKey", "binding", "provider", "label", "isDefault", "meta", "payload"];
const HINT_FIELDS = ["last4", "tokenLength"];

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
 * No owner key, sealed source envelope, or consumer grants enter the portable document.
 * @complexity O(n + payload bytes) reads and bounded platform KDF work; snapshot lives in memory.
 * @example const envelope = await exportOwnerStore({ store, passphrase });
 */
export async function exportOwnerStore({ store, passphrase }: { store: OwnerStoreService; passphrase: string }, _options: VaultOptions = {}): Promise<string> {
  const entries = await store.kernel.transaction(async () => {
    const snapshot: BackupEntry[] = [];
    for (const summary of await store.list({})) {
      const entry = await store.vault.get(summary);
      if (!entry) throw new OwnerStoreBackupError({ code: INVALID_BACKUP });
      snapshot.push({ id: summary.id, kind: summary.kind, ownerKey: summary.ownerKey, binding: summary.binding,
        provider: summary.provider, label: summary.label, isDefault: summary.isDefault, meta: summary.meta, payload: entry.payload,
        last4: summary.last4, tokenLength: summary.tokenLength });
    }
    return snapshot;
  });
  return sealWithPassphrase({ payload: JSON.stringify({ format: "jini-owner-store", version: 1, entries }), passphrase });
}

/** Authenticate and structurally validate before writing, then reuse vault parsing/sealing in
 * one transaction. Any row failure rolls back all rows. Grants remain inactive after restore.
 * @throws OwnerStoreBackupError for malformed snapshots or a nonempty destination; crypto/vault errors propagate.
 * @complexity O(n + payload bytes) with bounded platform KDF work.
 * @example await restoreOwnerStore({ store, envelope, passphrase });
 */
export async function restoreOwnerStore({ store, envelope, passphrase }: { store: OwnerStoreService; envelope: string; passphrase: string }, _options: VaultOptions = {}): Promise<{ restored: number }> {
  const entries = parseSnapshot({ payload: await openWithPassphrase({ envelope, passphrase }) });
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
    return { restored: entries.length };
  });
}

/** Reject unknown versions/duplicate IDs before any destination transaction is entered. */
function parseSnapshot({ payload }: { payload: string }): BackupEntry[] {
  let document: unknown;
  try { document = JSON.parse(payload); } catch { throw new OwnerStoreBackupError({ code: INVALID_BACKUP }); }
  if (!isObject(document)) throw new OwnerStoreBackupError({ code: INVALID_BACKUP });
  if (document.format !== "jini-owner-store" || document.version !== 1 || !Array.isArray(document.entries)) {
    throw new OwnerStoreBackupError({ code: INVALID_BACKUP });
  }
  const entries = document.entries.map(parseEntry);
  if (new Set(entries.map(entry => entry.id)).size !== entries.length) throw new OwnerStoreBackupError({ code: INVALID_BACKUP });
  return entries;
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
