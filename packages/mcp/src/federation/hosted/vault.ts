import type { ExternalMcpServerRecord, ExternalMcpStoreDeps, ExternalMcpSealedOAuthPayload, SealedExternalMcpOAuth } from "@jini-ai/core/contracts/hosted-mcp";
import { ExternalMcpSecretStoreUnconfiguredError } from "./unconfigured-error.js";
import { randomUUID } from "node:crypto";
import type { KeyringPort, SealedSecret, SecretSealerPort, VaultMeta, VaultRecord, VaultRepoPort } from "@jini-ai/core/contracts/vault";
import type { HostedMcpVaultPorts, HostedMcpStorePorts } from "./store-ports.js";

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

/** One stored row. `sealedEnv` is null when the server needs no credentials, which is normal. */
/** Compatibility DTO version for normalized vault envelopes; historical formats live in recovery. */
export const EXTERNAL_MCP_VAULT_VERSION = 1;
export type ExternalMcpIdentity = { workspaceId: string; serverId: string };

export type SealDeps = Pick<ExternalMcpStoreDeps, "sealer" | "keyring"> & HostedMcpStorePorts;
export type OpenDeps = { sealer: Pick<SecretSealerPort, "open"> } & HostedMcpStorePorts;

/** Opens `record`'s sealed env block, or returns `{}` when there is none to open. Split out of
 *  {@link resolveExternalMcpConfig} purely to keep that function's complexity under the shop
 *  ceiling — a decrypt failure is reported through the same ok/reason shape the caller already
 *  threads through, not thrown, since one unreadable server must not abort the whole read. */
export async function openExternalMcpEnv(
  record: Pick<ExternalMcpServerRecord, "sealedEnv" | "workspaceId" | "serverId" | "aadVersion">,
  deps: OpenDeps,
): Promise<{ readonly ok: true; readonly env: Record<string, string> } | { readonly ok: false; readonly reason: string }> {
  if (record.sealedEnv === null) return { ok: true, env: {} };
  try {
    const env = await openExternalMcpVaultPayload({ sealer: deps.sealer, sealed: record.sealedEnv, identity: record, kind: "mcp-env", ports: deps }) as Record<string, string>;
    return { ok: true, env };
  } catch {
    // These reasons reach admissions and chat tools. Parser/sealer errors can contain secret plaintext.
    return { ok: false, reason: `stored credentials could not be decrypted — check the site credential store and re-enter them in ${deps.settingsLink}` };
  }
}

/**
 * What the OAuth sealed blob holds.
 *
 * ONE blob rather than a column per secret, for exactly the reason the env block is one blob: every
 * read path wants the whole thing at once, and per-secret sealing would buy nothing and cost N
 * keyring round trips. The consequence is a READ-MODIFY-WRITE rule that every writer must honour —
 * unseal, change one member, reseal — because a writer that seals `{ tokens }` alone silently
 * deletes the operator's client secret.
 *
 * Structurally compatible with the OAuth client's `OAuthTokenSet`, but declared here rather than
 * imported: this is the STORED shape, and it must be able to stay still while the flow module's
 * in-memory type moves.
 */
/**
 * Schema version of the *plaintext* inside the sealed OAuth blob.
 *
 * Distinct from `oauth_aad_version`, which versions how the blob is BOUND to its row and says
 * nothing about what is inside it. Without this, a field could be added but never renamed, changed,
 * or removed — there would be nothing to branch on at open time, and the only way out would be a
 * migration over live credentials. Stamped at seal; a blob without it predates versioning and is
 * upgraded on read.
 */
export const EXTERNAL_MCP_OAUTH_PAYLOAD_VERSION = 1;

/**
 * The branching read for a sealed OAuth payload. A missing version is v0 (pre-versioning) and is
 * upgraded in place; a newer version is refused rather than misread, because silently
 * reinterpreting an unknown shape here means handing back a wrong or partial live credential.
 *
 * `schemaVersion` is stripped from the result: it is a wire concern, and a caller that saw it could
 * persist it back into a payload it does not own.
 *
 * The vault's open already refuses a non-object payload, so `parsed` is always an object here.
 *
 * @throws When the payload was written by a newer build than this one understands.
 * @complexity O(1).
 */
export function hydrateExternalMcpOAuthPayload(parsed: Record<string, unknown>): ExternalMcpSealedOAuthPayload {
  const { schemaVersion, ...rest } = parsed;
  const stored = typeof schemaVersion === "number" ? schemaVersion : 0;
  if (stored > EXTERNAL_MCP_OAUTH_PAYLOAD_VERSION) {
    throw new Error(
      `external MCP OAuth payload was written at schema version ${stored}, newer than this build understands (${EXTERNAL_MCP_OAUTH_PAYLOAD_VERSION}) — upgrade rather than risk misreading a live credential`,
    );
  }
  // v0 -> v1 added only the discriminator, so the upgrade is a stamp; a later version adds its own
  // branch here rather than a backfill over live credentials.
  return rest as ExternalMcpSealedOAuthPayload;
}

/**
 * Opens a row's sealed OAuth blob.
 *
 * @returns `{}` when the row holds none, which is the normal state before a connection is authorized.
 * @throws {ExternalMcpSecretStoreUnconfiguredError} When the blob exists but cannot be opened — a
 * rotated site key or a corrupt row. Distinct from "no blob" on purpose: the caller must not treat a
 * decryption failure as "not connected yet" and start a fresh authorization over a token that is
 * still live at the provider.
 * @complexity O(1) — one unseal.
 */
/** @agent-note `deps` is the per-call sealer plus the host-bound ports; exactly one `sealer.open` per call. */
export async function openExternalMcpOAuthPayload(
  deps: OpenDeps,
  record: Pick<ExternalMcpServerRecord, "sealedOAuth" | "workspaceId" | "serverId" | "oauthAadVersion">,
): Promise<ExternalMcpSealedOAuthPayload> {
  if (record.sealedOAuth === null) return {};
  let parsed: Record<string, unknown>;
  try {
    parsed = await openExternalMcpVaultPayload({ sealer: deps.sealer, sealed: record.sealedOAuth, identity: record, kind: "mcp-auth", ports: deps });
  } catch {
    throw new ExternalMcpSecretStoreUnconfiguredError(
      "Stored OAuth credentials could not be decrypted.",
    );
  }
  // Deliberately OUTSIDE the catch above: a version mismatch is not a decryption failure, and must
  // not be swallowed by a caller that treats that error as "not connected yet".
  return hydrateExternalMcpOAuthPayload(parsed);
}

/** @agent-note `deps` is the per-call sealer/keyring plus the host-bound ports; exactly one seal, the envelope is staged for the host repository's transaction. */
export async function sealExternalMcpOAuthPayload(
  deps: SealDeps,
  identity: ExternalMcpIdentity,
  payload: ExternalMcpSealedOAuthPayload,
): Promise<SealedExternalMcpOAuth> {
  const hasSecret =
    (payload.clientSecret !== undefined && payload.clientSecret !== "") || payload.tokens !== undefined || Boolean(payload.staticAccessToken);
  if (!hasSecret) return { sealedOAuth: null, oauthAadVersion: EXTERNAL_MCP_VAULT_VERSION };
  try {
    const sealedOAuth = await sealExternalMcpVaultPayload({ deps, identity, kind: "mcp-auth",
      // The discriminator remains authenticated inside the payload, never plain metadata.
      payload: JSON.parse(JSON.stringify({ ...payload, schemaVersion: EXTERNAL_MCP_OAUTH_PAYLOAD_VERSION })),
    });
    return { sealedOAuth, oauthAadVersion: EXTERNAL_MCP_VAULT_VERSION };
  } catch {
    throw new ExternalMcpSecretStoreUnconfiguredError(
      deps.credential.messages.storage,
    );
  }
}
