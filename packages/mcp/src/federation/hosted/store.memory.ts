import { isDeepStrictEqual } from "node:util";
import type { SealedSecret, VaultRecord, VaultRepoPort } from "@jini-ai/core/contracts/vault";
import { externalMcpVaultEnvelope, externalMcpVaultRecord, persistExternalMcpVaultEnvelope, deleteExternalMcpVaultEnvelope } from "./vault.js";
import type { ISODateTime, UUID } from "@jini-ai/core/primitives";

import { externalMcpAccessSnapshot } from "./access.js";
import type { ExternalMcpAccessUpdate, ExternalMcpServerRecord, ExternalMcpServerRepoPort } from "@jini-ai/core/contracts/hosted-mcp";
import type { HostedMcpVaultPorts } from "./store-ports.js";

/**
 * @file In-memory `ExternalMcpServerRepoPort` — the ADR-006 rule-of-two "first adapter", and the
 * double every store/route test binds instead of a real database.
 *
 * Keyed by `workspaceId` + `serverId` exactly as the table's composite primary key is, so a test
 * that leaks rows across workspaces fails here the same way it would against SQLite.
 *
 * {@link InMemoryExternalMcpServerRepo.tryClaimOAuthRefreshLease} reproduces the SQLite adapter's
 * compare-and-set SEMANTICS rather than its statement. It is genuinely atomic here for the reason
 * that matters in a test — JavaScript's single-threaded turn boundary means the read and the write
 * cannot be interleaved by another caller — so a test that asserts "the second claimant loses"
 * exercises the same contract the conditional UPDATE provides in production.
 */

function keyOf(workspaceId: UUID, serverId: string): string {
  return `${workspaceId} ${serverId}`;
}

type EnvelopeKind = "mcp-env" | "mcp-auth";
const ENVELOPE_FIELDS = [["mcp-env", "sealedEnv"], ["mcp-auth", "sealedOAuth"]] as const;
type EnvelopeField = typeof ENVELOPE_FIELDS[number][1];

/** A row's present envelopes as validated vault records, env first; throws VaultError("context")
 * when an envelope is not bound to this server and kind. @complexity O(1), at most two envelopes. */
function storedEnvelopes({ record, vaultErrors }: { record: ExternalMcpServerRecord | undefined; vaultErrors: HostedMcpVaultPorts["vaultErrors"] }, _options = {}): { kind: EnvelopeKind; field: EnvelopeField; vault: VaultRecord }[] {
  if (!record) return [];
  return ENVELOPE_FIELDS.flatMap(([kind, field]) => {
    const sealed = record[field];
    return sealed ? [{ kind, field, vault: externalMcpVaultRecord({ sealed, identity: record, kind, vaultErrors }) }] : [];
  });
}

/** The envelope stored under `id` in `repo`, or null when the row carries none of that kind. */
async function envelopeAt({ repo, workspaceId, id }: { repo: VaultRepoPort; workspaceId: UUID; id: string | null }, _options = {}): Promise<SealedSecret | null> {
  return id ? externalMcpVaultEnvelope({ record: (await repo.find({ workspaceId, id }))! }) : null;
}

/** @agent-note A test/first-adapter repository. The host binds `vault.createMemoryRepo` (a fresh, empty host in-memory vault repo per call) and `vaultErrors` once; the store using this repository must import envelopes from the same `./vault.js` instance. Writes are serialized on one queue, so lease CAS and access CAS are indivisible per instance. */
export class InMemoryExternalMcpServerRepo implements ExternalMcpServerRepoPort {
  private readonly rows = new Map<string, ExternalMcpServerRecord>();
  private readonly vaults = new Map<string, VaultRepoPort>();
  private pending: Promise<unknown> = Promise.resolve();

  constructor(private readonly ports: Pick<HostedMcpVaultPorts, "vault" | "vaultErrors">) {}

  private write<T>(body: () => Promise<T>): Promise<T> {
    const result = this.pending.then(body);
    this.pending = result.catch(() => {});
    return result;
  }

  /** Clone only one server's encrypted state; an aborted write leaves the live adapter intact. */
  private async stage({ previous }: { previous?: ExternalMcpServerRecord | undefined }): Promise<VaultRepoPort> {
    const repo = this.ports.vault.createMemoryRepo();
    for (const { vault } of storedEnvelopes({ record: previous, vaultErrors: this.ports.vaultErrors })) await repo.put({ record: { ...vault, revision: 1 }, expectedRevision: null });
    return repo;
  }

  private async hydrate({ record }: { record: ExternalMcpServerRecord }): Promise<ExternalMcpServerRecord> {
    const repo = this.vaults.get(keyOf(record.workspaceId, record.serverId))!;
    const saved = { ...record };
    for (const { field, vault } of storedEnvelopes({ record, vaultErrors: this.ports.vaultErrors })) {
      saved[field] = await envelopeAt({ repo, workspaceId: record.workspaceId, id: vault.id });
    }
    return saved;
  }

  async listByWorkspaceId(workspaceId: UUID): Promise<ExternalMcpServerRecord[]> {
    return Promise.all([...this.rows.values()].filter(row => row.workspaceId === workspaceId).map(record => this.hydrate({ record })));
  }

  async findByServerId(input: { workspaceId: UUID; serverId: string }): Promise<ExternalMcpServerRecord | null> {
    const record = this.rows.get(keyOf(input.workspaceId, input.serverId));
    return record ? this.hydrate({ record }) : null;
  }

  async upsert(record: ExternalMcpServerRecord): Promise<void> {
    await this.write(async () => {
      const key = keyOf(record.workspaceId, record.serverId);
      const previous = this.rows.get(key);
      // Stage a fresh Jini memory repository: failures leave both payloads and the row untouched.
      // Only this server's two envelopes are copied, so a save is bounded independently of roster size.
      const repo = await this.stage({ previous });
      const ids = {
        "mcp-env": await persistExternalMcpVaultEnvelope({ repo, sealed: record.sealedEnv, identity: record, kind: "mcp-env", vaultErrors: this.ports.vaultErrors }),
        "mcp-auth": await persistExternalMcpVaultEnvelope({ repo, sealed: record.sealedOAuth, identity: record, kind: "mcp-auth", vaultErrors: this.ports.vaultErrors }),
      };
      for (const { kind, vault } of storedEnvelopes({ record: previous, vaultErrors: this.ports.vaultErrors })) {
        if (vault.id !== ids[kind]) await deleteExternalMcpVaultEnvelope({ repo, workspaceId: record.workspaceId, id: vault.id });
      }
      // Publish both together only after all staged writes/deletes have succeeded.
      const saved = { ...record,
        sealedEnv: await envelopeAt({ repo, workspaceId: record.workspaceId, id: ids["mcp-env"] }),
        sealedOAuth: await envelopeAt({ repo, workspaceId: record.workspaceId, id: ids["mcp-auth"] }),
      };
      this.vaults.set(key, repo);
      this.rows.set(key, saved);
    });
  }

  /** The existing write queue makes snapshot comparison and access replacement indivisible.
   * No vault operation runs, so concurrent OAuth refresh payloads remain exactly as stored.
   * @complexity O(a+w) bounded grant bytes, O(1) row lookup and replacement.
   */
  async updateAccessIfCurrent(input: ExternalMcpAccessUpdate, _options = {}): Promise<boolean> {
    return this.write(async () => {
      const key = keyOf(input.workspaceId, input.serverId);
      const row = this.rows.get(key);
      if (!row || !isDeepStrictEqual(externalMcpAccessSnapshot({ record: row }), input.expected)) return false;
      this.rows.set(key, { ...row, ...input.access, writeGrantsUpdatedByPrincipalId: input.principalId,
        writeGrantsUpdatedAt: input.nowIso, updatedAt: input.nowIso });
      return true;
    });
  }

  async deleteByServerId(input: { workspaceId: UUID; serverId: string }): Promise<boolean> {
    return this.write(async () => {
      const key = keyOf(input.workspaceId, input.serverId);
      const previous = this.rows.get(key);
      if (!previous) return false;
      const repo = await this.stage({ previous });
      // The staged row is detached; live state is published only after Jini deletes both payloads.
      for (const { vault } of storedEnvelopes({ record: previous, vaultErrors: this.ports.vaultErrors })) {
        await deleteExternalMcpVaultEnvelope({ repo, workspaceId: input.workspaceId, id: vault.id });
      }
      this.rows.delete(key);
      this.vaults.delete(key);
      return true;
    });
  }

  async tryClaimOAuthRefreshLease(input: {
    workspaceId: UUID;
    serverId: string;
    nowIso: ISODateTime;
    leaseUntil: ISODateTime;
  }): Promise<boolean> {
    return this.write(async () => {
      const row = this.rows.get(keyOf(input.workspaceId, input.serverId));
      if (!row) return false;
      const held = row.oauthRefreshLeaseUntil;
      // A lease at or before `nowIso` is abandoned — a process that crashed mid-refresh must not wedge
      // the connection until something is restarted.
      if (held !== null && Date.parse(held) > Date.parse(input.nowIso)) return false;
      this.rows.set(keyOf(input.workspaceId, input.serverId), { ...row, oauthRefreshLeaseUntil: input.leaseUntil });
      return true;
    });
  }

  async releaseOAuthRefreshLease(input: { workspaceId: UUID; serverId: string }): Promise<void> {
    await this.write(async () => {
      const row = this.rows.get(keyOf(input.workspaceId, input.serverId));
      if (!row) return;
      this.rows.set(keyOf(input.workspaceId, input.serverId), { ...row, oauthRefreshLeaseUntil: null });
    });
  }
}
