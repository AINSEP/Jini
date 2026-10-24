import { openWithPassphrase, sealWithPassphrase } from "@jini-ai/platform/secrets";
import { isCopyableKind } from "@jini-ai/platform/secrets/credential-sets";
import { VAULT_KINDS, type VaultKind, type VaultMeta, type VaultOptions } from "@jini-ai/platform/secrets/credential-sets/contracts";
import { ownerContext, type OwnerPutInput, type OwnerStoreService } from "./service.js";

type BackupEntry = Required<Pick<OwnerPutInput, "id" | "kind" | "ownerKey" | "binding" | "provider" | "label" | "isDefault">>
  & { meta: VaultMeta; payload: VaultMeta | null };
const INVALID_BACKUP = "invalid-backup";
const ENTRY_FIELDS = ["id", "kind", "ownerKey", "binding", "provider", "label", "isDefault", "meta", "payload"];

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
        provider: summary.provider, label: summary.label, isDefault: summary.isDefault, meta: summary.meta, payload: entry.payload });
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
    // Nondefaults first: the vault auto-selects the first row, then explicit defaults win.
    for (const entry of [...entries].sort((a, b) => Number(a.isDefault) - Number(b.isDefault))) {
      await store.vault.put({ ...entry, ...ownerContext(entry), expectedRevision: null });
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
  if (keys.length !== ENTRY_FIELDS.length || keys.some(key => !ENTRY_FIELDS.includes(key))) throw new OwnerStoreBackupError({ code: INVALID_BACKUP });
  assertEntryIdentity(value);
  if (!isObject(value.meta) || !(value.payload === null || isObject(value.payload)) || typeof value.isDefault !== "boolean") {
    throw new OwnerStoreBackupError({ code: INVALID_BACKUP });
  }
  return value as unknown as BackupEntry;
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
