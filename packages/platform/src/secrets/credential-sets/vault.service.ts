import type { KeyringPort, SecretSealerPort } from "../ports.js";
import { credentialTokenHint } from "../credential-token.js";
import { buildVaultAad } from "./vault.aad.js";
import { isCopyableKind } from "./vault.meta.js";
import { VAULT_KINDS, VaultError, type VaultContext, type VaultIdentity, type VaultKind, type VaultMeta, type VaultMetaParsers,
  type VaultCopyResult, type VaultDefaultQuery, type VaultOptions, type VaultQuery, type VaultRecord, type VaultPutRecord, type VaultRepoPort, type VaultSummary } from "./vault.types.js";

export interface VaultServiceDeps {
  repo: VaultRepoPort;
  keyring: KeyringPort;
  sealer: SecretSealerPort;
  metaParsers: VaultMetaParsers;
  /** Host policy must throw on denial. No permissive default is provided. */
  authorize: (input: { action: "put" | "get" | "list" | "rotate" | "delete"; context: VaultContext | VaultIdentity | VaultQuery }) => Promise<void>;
  now: (input: VaultOptions) => string;
  newId: (input: VaultOptions) => string;
}
export interface VaultPutInput extends VaultContext {
  /** Omit for creation with an injected ID. Replacement requires id and expectedRevision. */
  id?: string;
  expectedRevision: number | null;
  provider: string | null;
  label: string;
  meta: unknown;
  /** null clears; omitted on replacement preserves the envelope/hint without opening or sealing.
   * Creation requires a payload (which may be null). Payloads are always sealed JSON.
   */
  payload?: VaultMeta | null | undefined;
  /** Omitted preserves same-group default status; creation/provider moves let the repository
   * apply its first-row rule. Explicit false opts out; true selects the destination default.
   */
  isDefault?: boolean | undefined;
  /** A host-selected token, never a URI or serialized connection object. */
  hintToken?: string;
}
export interface VaultCopyInput {
  /** This service owns the source repository, authorization and keyring-backed sealer. */
  source: SecretsVaultService;
  sourceContext: VaultContext;
  targetContext: VaultContext;
  ids: readonly string[];
  overwrite: boolean;
  /** Optional selection-time guard; otherwise the revisions read by this operation are used. */
  sourceRevisions?: Readonly<Record<string, number>>;
}

type CopyResultBody = Pick<VaultCopyResult, "status" | "last4" | "reasonCode">;
type CopyRowInput = VaultCopyInput & { id: string };
type Envelope = Pick<VaultRecord, "sealed" | "last4" | "tokenLength">;
/** Kinds whose payloads are addresses, environment maps or OAuth sessions, never single tokens. */
const HINTLESS_KINDS: readonly VaultKind[] = ["database-destination", "mcp-env", "mcp-auth"];

function isNonEmptyString({ value }: { value: unknown }): boolean {
  return typeof value === "string" && value !== "";
}
function isNullableString({ value }: { value: unknown }): boolean {
  return value === null || typeof value === "string";
}
function hasValidOwnership({ context }: { context: VaultContext | VaultQuery }): boolean {
  return isNonEmptyString({ value: context.workspaceId }) && isNonEmptyString({ value: context.ownerKey }) &&
    isNullableString({ value: context.principalId }) && (!("binding" in context) || isNullableString({ value: context.binding }));
}
function hasValidKind({ context }: { context: VaultContext | VaultQuery }): boolean {
  if (!VAULT_KINDS.some(kind => kind === context.kind) && context.kind !== "custom") return false;
  return context.kind !== "personal-execution" || Boolean(context.principalId);
}
function assertContext(context: VaultContext | VaultQuery): void {
  if (!hasValidOwnership({ context }) || !hasValidKind({ context })) throw new VaultError({ code: "context" });
}
/** Unified credential rows declare both subtype and compatibility; read defaults cover older rows. */
function declaresCredential({ meta }: { meta: unknown }): boolean {
  return meta !== null && typeof meta === "object" && Object.hasOwn(meta, "credentialType") && Object.hasOwn(meta, "worksFor");
}
function isInQueryScope({ record, query }: { record: VaultRecord; query: VaultQuery }): boolean {
  return record.workspaceId === query.workspaceId && record.kind === query.kind && record.ownerKey === query.ownerKey &&
    record.principalId === query.principalId && (query.provider === undefined || record.provider === query.provider);
}
/** Copy changes the site/key, never the credential's owning feature or endpoint. Principal
 * identities are local to each installation and cannot be carried to the target.
 */
function isCopyTarget({ sourceContext, targetContext, sameRepo }: { sourceContext: VaultContext; targetContext: VaultContext; sameRepo: boolean }): boolean {
  return sourceContext.kind === targetContext.kind && sourceContext.ownerKey === targetContext.ownerKey &&
    sourceContext.binding === targetContext.binding && sourceContext.principalId === null && targetContext.principalId === null &&
    !(sameRepo && sourceContext.workspaceId === targetContext.workspaceId);
}
function sourceNeedsUpgrade({ raw }: { raw: VaultRecord }): boolean {
  return Object.hasOwn(raw.meta, "legacyAad") || (raw.kind === "vendor" && !declaresCredential({ meta: raw.meta }));
}
function isStaleSelection({ selected, id, revision }: { selected: VaultCopyInput["sourceRevisions"]; id: string; revision: number }): boolean {
  if (!selected) return false;
  return Object.hasOwn(selected, id) && selected[id] !== revision;
}
function isCompatibleOverwrite({ existing, record }: { existing: VaultRecord; record: VaultRecord }): boolean {
  return existing.provider === record.provider && (record.kind !== "vendor" || existing.meta.credentialType === record.meta.credentialType);
}
function summary(record: VaultRecord): VaultSummary {
  // Enumerate the read model: an adapter's extra runtime properties cannot become API fields.
  return { workspaceId: record.workspaceId, id: record.id, kind: record.kind, ownerKey: record.ownerKey,
    principalId: record.principalId, binding: record.binding, provider: record.provider, label: record.label,
    isDefault: record.isDefault, revision: record.revision, tokenLength: record.tokenLength,
    last4: record.tokenLength !== null && record.tokenLength >= 12 ? record.last4?.slice(-4) ?? null : null,
    meta: record.meta, createdAt: record.createdAt, updatedAt: record.updatedAt, configured: record.sealed !== null };
}

/** Shared vault lifecycle. Policy/catalogs are injected; persistence and encryption are ports.
 * Expected context is checked before opening. Normal reads have no legacy-AAD fallback.
 * Metadata reads never need keys, and every merged patch is parsed before CAS persistence.
 */
export class SecretsVaultService {
  constructor(private readonly deps: VaultServiceDeps, _options: VaultOptions = {}) {}

  private authorize(input: Parameters<VaultServiceDeps["authorize"]>[0]): Promise<void> {
    const context = input.context;
    // Policy adapters receive only scope, never a put payload or a metadata patch through an
    // extra-property alias. This also keeps ordinary authorization diagnostics secret-free.
    return this.deps.authorize({ action: input.action, context: { workspaceId: context.workspaceId,
      kind: context.kind, ownerKey: context.ownerKey, principalId: context.principalId,
      ...("binding" in context ? { binding: context.binding } : {}),
      ...("id" in context ? { id: context.id } : {}),
      ...("provider" in context && context.provider !== undefined ? { provider: context.provider } : {}) } });
  }
  private parse(record: VaultRecord): VaultRecord {
    assertContext(record);
    return { ...record, meta: this.deps.metaParsers[record.kind]({ meta: record.meta, provider: record.provider }) };
  }
  private async find(input: VaultIdentity): Promise<VaultRecord | null> {
    const record = await this.deps.repo.find({ workspaceId: input.workspaceId, id: input.id });
    if (!record) return null;
    if (buildVaultAad(input) !== buildVaultAad(record)) throw new VaultError({ code: "context" });
    return this.parse(record);
  }
  private async seal(input: { context: VaultIdentity; payload: VaultMeta | null }): Promise<VaultRecord["sealed"]> {
    if (input.payload === null) return null;
    // JSON round-trip makes the payload contract explicit; encryption never receives an object
    // coerced to '[object Object]' or a connection URI masquerading as an entire payload.
    if (typeof input.payload !== "object" || Array.isArray(input.payload)) throw new VaultError({ code: "invalid-record" });
    const plaintext = JSON.stringify(input.payload);
    return this.deps.sealer.seal({ plaintext, key: await this.deps.keyring.activeKey({}), aad: buildVaultAad(input.context) });
  }
  private async open(record: VaultRecord): Promise<VaultMeta | null> {
    if (!record.sealed) return null;
    const plaintext = await this.deps.sealer.open({ sealed: record.sealed }, { aad: buildVaultAad(record) });
    let payload: unknown;
    try { payload = JSON.parse(plaintext); } catch { throw new VaultError({ code: "invalid-record" }); }
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) throw new VaultError({ code: "invalid-record" });
    return payload as VaultMeta;
  }

  /** Create/replace configuration and a sealed JSON payload. Throws on policy, validation or CAS failure. */
  async put(input: VaultPutInput, _options: VaultOptions = {}): Promise<VaultSummary> {
    const record = await this.prepare(input);
    return summary(this.parse(await this.deps.repo.put({ record, expectedRevision: input.expectedRevision })));
  }

  /** Authorize, validate and seal before the host enters its transaction, without persisting.
   * Replacements retain identity/createdAt; omitted payload preserves the existing envelope.
   * Commit must CAS again because preparation does not reserve a revision or a default.
   * Prepared records contain envelopes and stay private to the host, never a public read model.
   * @example const record = await vault.prepare(input); await repo.put({ record, expectedRevision: input.expectedRevision }); // inside the host transaction
   */
  async prepare(input: VaultPutInput, _options: VaultOptions = {}): Promise<VaultPutRecord> {
    assertContext(input);
    // Existing custom-kind identities keep their authenticated kind until a migration marks
    // them for boot resealing. New credentials always use the unified vendor kind.
    if (input.kind === "custom" && input.expectedRevision === null) throw new VaultError({ code: "context" });
    await this.authorize({ action: "put", context: input });
    const { identity, existing } = await this.findForPut({ input });
    const meta = this.parsePutMeta({ input, existing });
    const { sealed, last4, tokenLength } = await this.putEnvelope({ input, identity, existing });
    const now = this.deps.now({});
    return { ...identity, provider: input.provider, label: input.label, meta, sealed,
      isDefault: input.isDefault ?? (existing !== null && existing.provider === input.provider ? existing.isDefault : undefined),
      revision: (input.expectedRevision ?? 0) + 1, last4, tokenLength,
      createdAt: existing === null ? now : existing.createdAt, updatedAt: now };
  }
  /** Resolve the target identity and apply the service-level CAS precheck. */
  private async findForPut({ input }: { input: VaultPutInput }): Promise<{ identity: VaultIdentity; existing: VaultRecord | null }> {
    if (input.expectedRevision !== null && !input.id) throw new VaultError({ code: "conflict" });
    const identity: VaultIdentity = { workspaceId: input.workspaceId, kind: input.kind, ownerKey: input.ownerKey,
      principalId: input.principalId, binding: input.binding, id: input.id ?? this.deps.newId({}) };
    const existing = await this.find(identity);
    if (input.expectedRevision === null ? existing !== null : existing?.revision !== input.expectedRevision) throw new VaultError({ code: "conflict" });
    return { identity, existing };
  }
  private parsePutMeta({ input, existing }: { input: VaultPutInput; existing: VaultRecord | null }): VaultMeta {
    // Read defaults keep older sites usable; new records still declare their subtype/compatibility.
    if (!existing && input.kind === "vendor" && !declaresCredential({ meta: input.meta })) throw new VaultError({ code: "invalid-meta" });
    const meta = this.deps.metaParsers[input.kind]({ meta: input.meta, provider: input.provider });
    if (existing?.kind === "vendor" && existing.meta.credentialType !== meta.credentialType) throw new VaultError({ code: "context" });
    return meta;
  }
  /** Omitted payload keeps the existing envelope and hints without opening or sealing. */
  private async putEnvelope({ input, identity, existing }: { input: VaultPutInput; identity: VaultIdentity; existing: VaultRecord | null }): Promise<Envelope> {
    if (input.payload === undefined) {
      if (!existing) throw new VaultError({ code: "invalid-record" });
      return { sealed: existing.sealed, last4: existing.last4, tokenLength: existing.tokenLength };
    }
    const sealed = await this.seal({ context: identity, payload: input.payload });
    // Never expose any suffix of a database address, environment map or OAuth session.
    const hint = sealed && input.hintToken !== undefined && !HINTLESS_KINDS.includes(input.kind)
      ? credentialTokenHint({ token: input.hintToken }) : null;
    return { sealed, last4: hint?.last4 ?? null, tokenLength: hint?.length ?? null };
  }

  /** Authorized runtime read; returns plaintext only to the caller that supplied exact ownership. */
  async get(input: VaultIdentity, _options: VaultOptions = {}): Promise<{ summary: VaultSummary; payload: VaultMeta | null } | null> {
    assertContext(input);
    await this.authorize({ action: "get", context: input });
    const record = await this.find(input);
    return record ? { summary: summary(record), payload: await this.open(record) } : null;
  }

  /** Singleton runtime read using one provider-independent lookup. Full expected ownership and
   * binding are required before policy/decryption; repo callers may use a broader selection scope.
   * @example await vault.findOne({ workspaceId, kind: "site-assistant", ownerKey: "assistant", principalId: null, binding: null });
   */
  async findOne(input: VaultContext, _options: VaultOptions = {}): Promise<{ summary: VaultSummary; payload: VaultMeta | null } | null> {
    assertContext(input);
    await this.authorize({ action: "get", context: input });
    if (!this.deps.repo.findOne) throw new VaultError({ code: "invalid-record" });
    const record = await this.deps.repo.findOne(input);
    if (!record) return null;
    if (buildVaultAad({ ...input, id: record.id }) !== buildVaultAad(record)) throw new VaultError({ code: "context" });
    const parsed = this.parse(record);
    return { summary: summary(parsed), payload: await this.open(parsed) };
  }

  /** Authorized default read using one exact-group query; ownership is checked before opening.
   * @throws On policy, context, metadata or authentication failure.
   * @complexity One indexed row lookup, then O(payload size) decryption.
   */
  async findDefault(input: VaultDefaultQuery & { binding: string | null }, _options: VaultOptions = {}): Promise<{ summary: VaultSummary; payload: VaultMeta | null } | null> {
    assertContext(input);
    await this.authorize({ action: "get", context: input });
    // Old injected ports retain their existing operations; default reads require this capability.
    if (!this.deps.repo.findDefault) throw new VaultError({ code: "invalid-record" });
    const record = await this.deps.repo.findDefault(input);
    if (!record) return null;
    if (!record.isDefault || record.provider !== input.provider || buildVaultAad({ ...input, id: record.id }) !== buildVaultAad(record)) {
      throw new VaultError({ code: "context" });
    }
    const parsed = this.parse(record);
    return { summary: summary(parsed), payload: await this.open(parsed) };
  }

  /** Copy selected rows into this service without exposing plaintext or envelopes. Each ID is
   * attempted once; failures are isolated and raw adapter/policy/crypto errors never escape.
   * Source reads are plain SELECTs; this operation never upgrades or writes the source.
   * @throws VaultError for invalid scopes. Per-row failures use fixed reason codes.
   * @complexity O(n + payload bytes), n unique IDs; sequential bounded row reads and CAS writes.
   */
  async copyToSite(input: VaultCopyInput, _options: VaultOptions = {}): Promise<VaultCopyResult[]> {
    assertContext(input.sourceContext);
    assertContext(input.targetContext);
    const results: VaultCopyResult[] = [];
    for (const id of new Set(input.ids)) results.push(await this.copyRow({ ...input, id }));
    return results;
  }

  /** One transfer reuses both services' parsing/open/seal and the repository's default/CAS owner.
   * @complexity Constant row queries plus O(payload size); no group read or source transaction.
   */
  private async copyRow(input: CopyRowInput): Promise<VaultCopyResult> {
    const { sourceContext, id } = input;
    const result = { kind: sourceContext.kind, id };
    if (!isCopyableKind[sourceContext.kind]) return { ...result, status: "skipped",
      reasonCode: sourceContext.kind === "mcp-env" ? "requires-mcp-configuration" : "kind-not-copyable" };
    try {
      return { ...result, ...(await this.transferRow(input)) };
    } catch (error) {
      return { ...result, status: "failed", reasonCode: error instanceof VaultError ? error.code : "copy-failed" };
    }
  }
  /** Guarded read of the source row, then a CAS write of the resealed target row. */
  private async transferRow(input: CopyRowInput): Promise<CopyResultBody> {
    const { source, sourceContext, targetContext, id } = input;
    if (!isCopyTarget({ sourceContext, targetContext, sameRepo: source.deps.repo === this.deps.repo })) throw new VaultError({ code: "context" });
    const sourceIdentity = { ...sourceContext, id };
    const targetIdentity = { ...targetContext, id };
    await source.authorize({ action: "get", context: sourceIdentity });
    await this.authorize({ action: "put", context: targetIdentity });
    const raw = await source.deps.repo.find(sourceIdentity);
    if (!raw) return { status: "failed", reasonCode: "source-missing" };
    if (buildVaultAad(sourceIdentity) !== buildVaultAad(raw)) throw new VaultError({ code: "context" });
    // Check before parsing: normal parsers deliberately reject legacy-AAD metadata.
    if (sourceNeedsUpgrade({ raw })) return { status: "failed", reasonCode: "source-needs-upgrade" };
    if (isStaleSelection({ selected: input.sourceRevisions, id, revision: raw.revision })) throw new VaultError({ code: "conflict" });
    const record = source.parse(raw);
    const existing = await this.find(targetIdentity);
    if (existing && !input.overwrite) return { status: "skipped", reasonCode: "target-exists" };
    const last4 = summary(await this.writeCopy({ source, record, targetIdentity, existing })).last4;
    return { status: "copied", ...(last4 ? { last4 } : {}) };
  }
  /** Overwrite keeps the target's default, revision chain and creation time. */
  private async writeCopy({ source, record, targetIdentity, existing }:
    { source: SecretsVaultService; record: VaultRecord; targetIdentity: VaultIdentity; existing: VaultRecord | null }): Promise<VaultRecord> {
    if (existing && !isCompatibleOverwrite({ existing, record })) throw new VaultError({ code: "context" });
    const now = this.deps.now({});
    const placement = existing
      ? { isDefault: existing.isDefault, revision: existing.revision + 1, createdAt: existing.createdAt }
      : { isDefault: false, revision: 1, createdAt: now };
    const candidate = this.parse({ ...record, ...targetIdentity, ...placement, updatedAt: now });
    candidate.sealed = await this.seal({ context: targetIdentity, payload: await source.open(record) });
    // Reuse the source's hint policy without guessing a token field from a structured payload.
    const hintless = record.kind === "database-destination";
    candidate.last4 = hintless ? null : summary(record).last4;
    candidate.tokenLength = hintless ? null : record.tokenLength;
    return this.deps.repo.put({ record: candidate, expectedRevision: existing ? existing.revision : null });
  }

  /** Human-managed scoped inventory. No envelope or plaintext is opened or returned. */
  async list(input: VaultQuery, _options: VaultOptions = {}): Promise<VaultSummary[]> {
    assertContext(input);
    await this.authorize({ action: "list", context: input });
    return (await this.deps.repo.list(input)).map(record => {
      if (!isInQueryScope({ record, query: input })) throw new VaultError({ code: "context" });
      return summary(this.parse(record));
    });
  }

  /** Merge and validate complete metadata, then target only changed JSON keys with revision CAS. */
  async patchMeta(input: VaultIdentity & { expectedRevision: number; patch: VaultMeta }, _options: VaultOptions = {}): Promise<VaultSummary> {
    assertContext(input);
    await this.authorize({ action: "put", context: input });
    const existing = await this.find(input);
    if (existing?.revision !== input.expectedRevision) throw new VaultError({ code: "conflict" });
    const meta = this.deps.metaParsers[existing.kind]({ meta: { ...existing.meta, ...input.patch }, provider: existing.provider });
    if (existing.kind === "vendor" && existing.meta.credentialType !== meta.credentialType) throw new VaultError({ code: "context" });
    // jsonSet can add/replace a key but cannot remove one. Reject parser omissions instead of
    // silently persisting an unvalidated old field. Normalized values and defaults can be patched.
    if (Object.keys({ ...existing.meta, ...input.patch }).some(key => !Object.hasOwn(meta, key))) throw new VaultError({ code: "invalid-meta" });
    const patch = Object.fromEntries(Object.entries(meta).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(existing.meta[key])));
    return summary(this.parse(await this.deps.repo.patchMeta({ workspaceId: input.workspaceId, id: input.id,
      expectedRevision: input.expectedRevision, patch, updatedAt: this.deps.now({}) })));
  }

  /** Re-seal using the active key; concurrent replacement wins through CAS. Metadata-only rows persist. */
  async rotate(input: VaultIdentity & { expectedRevision: number }, _options: VaultOptions = {}): Promise<VaultSummary> {
    assertContext(input);
    await this.authorize({ action: "rotate", context: input });
    const existing = await this.find(input);
    if (existing?.revision !== input.expectedRevision) throw new VaultError({ code: "conflict" });
    const sealed = await this.seal({ context: input, payload: await this.open(existing) });
    return summary(this.parse(await this.deps.repo.put({ expectedRevision: input.expectedRevision,
      record: { ...existing, sealed, revision: existing.revision + 1, updatedAt: this.deps.now({}) } })));
  }

  /** Idempotent for missing rows; existing rows require matching context and revision. */
  async delete(input: VaultIdentity & { expectedRevision: number }, _options: VaultOptions = {}): Promise<boolean> {
    assertContext(input);
    await this.authorize({ action: "delete", context: input });
    const existing = await this.find(input);
    if (!existing) return false;
    if (existing.revision !== input.expectedRevision) throw new VaultError({ code: "conflict" });
    return this.deps.repo.delete({ workspaceId: input.workspaceId, id: input.id, expectedRevision: input.expectedRevision });
  }
}
