import type { SecretsVaultService } from "./vault.service.js";
import { VaultError, isInVaultQueryScope, type VaultKind, type VaultMeta, type VaultOptions, type VaultPutRecord, type VaultQuery, type VaultRepoPort } from "./vault.types.js";

/** Logical transport only: source workspace, root keys, envelopes and revision history never travel. */
export interface VaultArchiveEntry {
  id: string;
  kind: VaultKind;
  ownerKey: string;
  binding: string | null;
  provider: string | null;
  label: string;
  isDefault: boolean;
  meta: VaultMeta;
  payload: VaultMeta | null;
}

function assertPortable(kind: VaultKind, principalId: string | null): void {
  // Personal and MCP credentials require their own identity/configuration transport, outside v1.
  if (principalId !== null || ["personal-execution", "mcp-env", "mcp-auth"].includes(kind)) throw new VaultError({ code: "context" });
}

/** Capture through the owning service's authorization and parsers. Hosts supply exact scopes and
 * attachment-filtered repositories; this helper never discovers other workspaces or principals.
 * Diagnostics contain only a count, because even labels/IDs may contain pasted secrets.
 * @example const captured = await captureVaultArchive({ vault, repo, queries: [siteScope] });
 * @complexity O(rows + payload bytes), bounded to 2,000 rows by the transport contract.
 */
export async function captureVaultArchive(
  { vault, queries, repo }: { vault: SecretsVaultService; queries: readonly VaultQuery[]; repo?: Pick<VaultRepoPort, "list"> },
  _options: VaultOptions = {},
): Promise<{ entries: VaultArchiveEntry[]; notices: string[] }> {
  const entries: VaultArchiveEntry[] = [];
  let omitted = 0, count = 0;
  for (const query of queries) {
    assertPortable(query.kind, query.principalId);
    // Optional raw enumeration isolates unsupported metadata; every payload still passes get's
    // exact identity, authorization, parser and AAD checks before it can enter the result.
    for (const row of await (repo ?? vault).list(query)) {
      if (++count > 2000) throw new VaultError({ code: "invalid-record" });
      try {
        if (!isInVaultQueryScope({ record: row, query })) throw new VaultError({ code: "context" });
        const found = await vault.get(row);
        if (!found) throw new VaultError({ code: "conflict" });
        const s = found.summary;
        entries.push({ id: s.id, kind: s.kind, ownerKey: s.ownerKey, binding: s.binding, provider: s.provider,
          label: s.label, isDefault: s.isDefault, meta: s.meta, payload: found.payload });
      } catch { omitted++; }
    }
  }
  return { entries, notices: omitted ? [`${omitted} saved credential(s) could not be opened and were left out.`] : [] };
}

/** Validate and re-seal every entry before the host atomically commits any of them. Keeping the
 * transaction in the host lets settings and vault rows join the same commit. Never call put in a
 * loop: a bad later entry must leave the recipient completely unchanged.
 * @throws VaultError or the host's policy error; callers expose a fixed optional-import notice.
 * @example const records = await prepareVaultArchiveRestore({ vault, workspaceId, entries });
 * @complexity O(entries + payload bytes), at most 2,000 entries.
 */
export async function prepareVaultArchiveRestore(
  { vault, workspaceId, entries }: { vault: SecretsVaultService; workspaceId: string; entries: readonly VaultArchiveEntry[] },
  _options: VaultOptions = {},
): Promise<VaultPutRecord[]> {
  if (!Array.isArray(entries) || entries.length > 2000) throw new VaultError({ code: "invalid-record" });
  const ids = new Set<string>();
  const records: VaultPutRecord[] = [];
  for (const entry of entries) {
    assertPortable(entry.kind, null);
    if (ids.has(entry.id)) throw new VaultError({ code: "invalid-record" });
    ids.add(entry.id);
    // Enumerating fields prevents an archive from supplying a revision, principal or workspace.
    records.push(await vault.prepare({ workspaceId, id: entry.id, kind: entry.kind, ownerKey: entry.ownerKey,
      principalId: null, binding: entry.binding, provider: entry.provider, label: entry.label,
      isDefault: entry.isDefault, meta: entry.meta, payload: entry.payload, expectedRevision: null }));
  }
  return records;
}
