import { randomUUID } from "node:crypto";
import type { KeyringPort, SealedSecret, SecretSealerPort, VaultMeta, VaultRecord, VaultRepoPort } from "@jini-ai/core/contracts/vault";
import type { HostedMcpVaultPorts } from "./store-ports.js";

/** Expected owner of an envelope: the workspace and the server row it belongs to. */
/** @agent-note Supplied by the caller from the row being read or written, never inferred from an envelope. */
export type Identity = { workspaceId: string; serverId: string };
/** The two saved vault kinds an MCP row can carry. */
/** @agent-note Saved format: these strings are authenticated vault kinds (AAD); never rename. */
export type Kind = "mcp-env" | "mcp-auth";
const contextKey = Symbol("external-mcp-vault-context");
const stagedKey = Symbol("external-mcp-staged");
type Envelope = SealedSecret & { [contextKey]?: Omit<VaultRecord, "sealed">; [stagedKey]?: boolean };

// The public MCP row still carries opaque envelopes. A non-enumerable context travels with each
// envelope in memory; only its vault ID is persisted on the server. No plaintext cache or registry.
/** @agent-note This module is the ONE envelope module: its two private symbols are shared by the host SQL repository, the in-memory repository, the store and every host shim, so all of them must import it from this same module instance (one copy loaded). Only a repository rebuilds the context, from its own stored vault row. */
export function externalMcpVaultEnvelope({ record }: { record: VaultRecord }, { staged = false }: { staged?: boolean } = {}): SealedSecret | null {
  if (!record.sealed) return null;
  const { sealed, ...context } = record;
  return Object.defineProperties({ ...sealed }, { [contextKey]: { value: context }, [stagedKey]: { value: staged } });
}

/** Validate the expected server/kind before a read or write; never infer authorization from a row. */
/** @agent-note `vaultErrors` is the host-bound factory; a missing or foreign context throws its `context` error before any crypto. */
export function externalMcpVaultRecord(
  { sealed, identity, kind, vaultErrors }: { sealed: SealedSecret; identity: Identity; kind: Kind; vaultErrors: HostedMcpVaultPorts["vaultErrors"] }, _options = {},
): VaultRecord {
  const context = (sealed as Envelope)[contextKey];
  if (!context) throw vaultErrors.create({ code: "context" });
  const invalidOwner = context.workspaceId !== identity.workspaceId || context.ownerKey !== identity.serverId;
  const invalidScope = context.kind !== kind || context.principalId !== null || context.binding !== null;
  if (invalidOwner || invalidScope) throw vaultErrors.create({ code: "context" });
  return { ...context, sealed: { keyId: sealed.keyId, ciphertext: sealed.ciphertext, nonce: sealed.nonce, alg: sealed.alg } };
}

function service({ repo, sealer, keyring, identity, kind, ports }: {
  repo: VaultRepoPort; sealer: SecretSealerPort; keyring: KeyringPort; identity: Identity; kind: Kind; ports: HostedMcpVaultPorts;
}) {
  const { vaultErrors } = ports;
  // Refuse a foreign kind before its metadata parser or any crypto can run.
  if (kind !== "mcp-env" && kind !== "mcp-auth") throw vaultErrors.create({ code: "context" });
  const metaParsers = ports.metaParsers({
    validateMeta: ({ kind: requested, meta }) => {
      if (requested !== "mcp-env" && requested !== "mcp-auth") throw vaultErrors.create({ code: "context" });
      return meta;
    },
  });
  return ports.vault.createService({ repo, sealer, keyring, metaParsers,
    authorize: async ({ context }) => {
      if (context.workspaceId !== identity.workspaceId || context.ownerKey !== identity.serverId ||
        context.kind !== kind || context.principalId !== null) throw vaultErrors.create({ code: "context" });
    }, now: () => new Date().toISOString(), newId: () => randomUUID() });
}

/** Stage ciphertext through Jini; the host repository commits it with pointers/status/expiry.
 * @complexity O(payload bytes), one seal, no database I/O before the host transaction.
 */
/** @agent-note `deps` carries the per-call sealer/keyring plus the host-bound vault ports. Exactly one seal; the id is generated here, before the put, and the envelope is returned staged for the host repository's own transaction. */
export async function sealExternalMcpVaultPayload(
  { deps, identity, kind, payload }: { deps: { sealer: SecretSealerPort; keyring: KeyringPort } & HostedMcpVaultPorts; identity: Identity;
    kind: Kind; payload: VaultMeta }, _options = {},
): Promise<SealedSecret> {
  const repo = deps.vault.createMemoryRepo();
  const id = randomUUID();
  const saved = await service({ repo, sealer: deps.sealer, keyring: deps.keyring, identity, kind, ports: deps }).put({ workspaceId: identity.workspaceId,
    kind, ownerKey: identity.serverId, principalId: null, binding: null, expectedRevision: null,
    id, provider: null, label: id, meta: {}, payload });
  const record = await repo.find(saved);
  if (!record?.sealed) throw deps.vaultErrors.create({ code: "invalid-record" });
  return externalMcpVaultEnvelope({ record }, { staged: true })!;
}

/** Opening a hydrated envelope performs no extra SQL; legacy AAD belongs to boot normalization.
 * @complexity O(payload bytes), one open; expected ownership is checked before crypto.
 */
/** @agent-note `ports` are the host-bound vault ports. Exactly one `sealer.open`; ownership and kind are checked before it, and the seal/keyring sides are fail-closed. */
export async function openExternalMcpVaultPayload(
  { sealer, sealed, identity, kind, ports }: { sealer: Pick<SecretSealerPort, "open">; sealed: SealedSecret;
    identity: Identity; kind: Kind; ports: HostedMcpVaultPorts }, _options = {},
): Promise<VaultMeta> {
  const record = externalMcpVaultRecord({ sealed, identity, kind, vaultErrors: ports.vaultErrors });
  const repo = ports.vault.createMemoryRepo();
  await repo.put({ record: { ...record, revision: 1 }, expectedRevision: null });
  // Reads never acquire a sealing key. These fail-closed ports guard accidental future writes.
  const unavailable = async (): Promise<never> => { throw ports.vaultErrors.create({ code: "invalid-record" }); };
  const vault = service({ repo, identity, kind, sealer: { open: sealer.open.bind(sealer), seal: unavailable },
    keyring: { activeKey: unavailable, deriveSigningSecret: unavailable, derive: unavailable }, ports });
  const opened = await vault.get({ workspaceId: identity.workspaceId, id: record.id, kind,
    ownerKey: identity.serverId, principalId: null, binding: null });
  if (!opened?.payload) throw ports.vaultErrors.create({ code: "invalid-record" });
  return opened.payload;
}

/** Persist staged envelopes with Jini CAS; carried envelopes must still exist byte-for-byte.
 * @complexity Constant indexed reads/writes per envelope; callers own the surrounding transaction.
 */
/** @agent-note Called by a host repository inside its own transaction with its own vault repo; `vaultErrors` is the host-bound factory. A carried (non-staged) envelope must still exist byte-for-byte, otherwise `conflict`. */
export async function persistExternalMcpVaultEnvelope(
  { repo, sealed, identity, kind, vaultErrors }: { repo: VaultRepoPort; sealed: SealedSecret | null; identity: Identity; kind: Kind; vaultErrors: HostedMcpVaultPorts["vaultErrors"] }, _options = {},
): Promise<string | null> {
  if (!sealed) return null;
  const record = externalMcpVaultRecord({ sealed, identity, kind, vaultErrors });
  const existing = await repo.find(record);
  if (existing) {
    if (existing.kind !== kind || existing.ownerKey !== identity.serverId ||
      JSON.stringify(existing.sealed) !== JSON.stringify(record.sealed)) throw vaultErrors.create({ code: "conflict" });
    return record.id;
  }
  if (!(sealed as Envelope)[stagedKey]) throw vaultErrors.create({ code: "conflict" });
  await repo.put({ record: { ...record, revision: 1 }, expectedRevision: null });
  return record.id;
}

/** Call only after unlinking the server pointer; read the revision after any default changes. */
/** @agent-note Uses the caller's repo inside the caller's transaction; deletes at the revision it just read. */
export async function deleteExternalMcpVaultEnvelope(
  { repo, workspaceId, id }: { repo: VaultRepoPort; workspaceId: string; id: string | null }, _options = {},
): Promise<void> {
  if (!id) return;
  const record = await repo.find({ workspaceId, id });
  if (record) await repo.delete({ workspaceId, id, expectedRevision: record.revision });
}
