import { PublishCredentialValidationError, validatedWorksFor, updatedWorksFor, validateLabel, optionalBoolean, validateConnection, connectionCredentialSpec, isSecretField, preservedMove, type ValidatedConnection } from './store-validation.js';
import type { PublishCredentialResolveDeps } from './store-resolution.js';
import { ownerOf } from './store-owner.js';
import type { Clock as ClockPort, UUID } from "@jini-ai/core/primitives";

import { isUniqueViolation } from "@jini-ai/core/contracts/storage";
import type { KeyringPort } from "@jini-ai/core/contracts/vault";
import type { SecretSealerPort } from "@jini-ai/core/contracts/vault";
import { VaultError, type VaultSummary } from "@jini-ai/core/contracts/vault";
import type { VaultContext, VaultRepoPort, VendorCredentialSetRecord as CoreVendorRecord, VendorCredentialSetRepoPort as CoreVendorRepo } from "@jini-ai/core/contracts/vault";
import type { CredentialTokenHint } from "@jini-ai/core/contracts/site/secrets-credential-token";
import type { SecretsVaultService } from "@jini-ai/core/contracts/site/secrets-credential-sets";
interface ScopedCredentialDeps<D> { readonly deps: D; readonly workspaceId: string; readonly scope: "site" | "project" }
import type { DeployTargetCredentialSpec, DeployTargetFieldSpec, DeployTargetRegistry } from "@jini-ai/devops/deploy/site/deploy-targets/types";
import type { PublishConnectionInput, PublishCredentialScope, PublishCredentialSummary, PublishProviderId } from "@jini-ai/devops/deploy/site/publish-credentials/types";

/** Publish credentials map deploy hosts to vendor accounts. Feature validation and human-gated
 * verification remain here; Jini's vault owns sealing, defaults and persistence. Create/update
 * are shared with an agent-facing caller, so provider probes stay in the human-gated verify path.
 * Migration 0012 folds legacy rows once; there is no recurring backfill to resurrect deletions. */


/** A `(workspaceId, vendor, label)` collision — the route maps this to `409 DUPLICATE_LABEL`. */
export class PublishCredentialDuplicateLabelError extends Error {}

/** Thrown when `sealer.seal()`/`keyring.activeKey()` fails while writing a connection — the realistic
 *  cause is a missing site key (the site key), same fail-closed contract
 *  `SiteAssistantSecretStoreUnconfiguredError` documents for the sibling ADR-058 table. */
export class PublishCredentialSecretStoreUnconfiguredError extends Error {}

export class PublishCredentialNotFoundError extends Error {}

/** Deploy descriptors adapt into Jini's compatibility and selection policy. Required companion
 * fields exclude token-only custom keys before any default is selected. No I/O; O(hosts).
 */
export function publishHostsForCredential({ deps, credential, registry }: {
  deps: Pick<PublishCredentialReadDeps, "matchingCredentialProviderIds">; credential: Pick<VaultSummary, "kind" | "provider" | "label" | "meta">; registry: DeployTargetRegistry;
}, _options = {}): string[] {
  return deps.matchingCredentialProviderIds({ credential, providers: registry.list().flatMap(({ descriptor }) => {
    if (!moduleAcceptsCredential({ credential, registry, targetId: descriptor.id })) return [];
    const spec = descriptor.credential;
    return spec ? [{ id: descriptor.id, vendorId: spec.vendorId,
      acceptsCustomToken: !spec.fields.some(field => field.required && field.name !== spec.tokenField) }] : [];
  }) });
}

/** Only narrow eligibility here; the existing Jini matcher still owns worksFor/default selection.
 * No persisted metadata changes, so an old vendor grant cannot silently acquire a new capability. */
function moduleAcceptsCredential({ credential, registry, targetId }: {
  credential: Pick<VaultSummary, "meta">; registry: DeployTargetRegistry; targetId: string;
}, _options = {}): boolean {
  const accepts = registry.get(targetId)?.module.acceptsCredential;
  if (!accepts) return true;
  const worksFor = credential.meta.worksFor;
  if (!Array.isArray(worksFor) || !worksFor.every(id => typeof id === "string")) return false;
  return accepts({ worksFor });
}

/** The vault's `hintToken` for a connection: its token field's value, omitted when the field is absent. O(1). */
function hintTokenOf(required: { fields: Readonly<Record<string, string | undefined>>; tokenField: string }, _optional: Record<string, never> = {}): { hintToken?: string } {
  const hintToken = required.fields[required.tokenField];
  return hintToken === undefined ? {} : { hintToken };
}

/** An explicit id is found in either store. Otherwise the first store (in `inventory` order: this
 * site's, then the project's) holding any compatible row decides alone (owner 2026-10-25: a site row
 * overrides), so an ambiguous site stays ambiguous instead of silently using a project key.
 * @complexity O(rows × compatibility IDs).
 */
export function selectPublishCredential({ deps, registry, credentials, provider, id }: {
  deps: Pick<PublishCredentialReadDeps, "selectCredentialForProvider">; registry: DeployTargetRegistry; credentials: readonly VaultSummary[];
  provider: NonNullable<ReturnType<typeof providerContract>>; id?: string | undefined;
}, _options = {}): VaultSummary | null {
  const eligible = credentials.filter(credential => moduleAcceptsCredential({ credential, registry, targetId: provider.id }));
  if (id !== undefined) return deps.selectCredentialForProvider({ credentials: eligible, provider, id });
  const decides = eligible.find(row => deps.selectCredentialForProvider({ credentials: [row], provider, id: row.id }));
  return deps.selectCredentialForProvider({ credentials: eligible.filter(row => row.workspaceId === decides?.workspaceId), provider });
}
/** Compatibility edits invalidate only hosts whose eligibility changed, through the existing cache
 * port. Catalog adaptation and custom token shape rules are shared with runtime matching.
 * @complexity O(hosts × compatibility IDs); no credential reads, opens or provider requests.
 */
export function invalidatePublishCredentialCompatibility({ deps, workspaceId, registry, cache, before, after }: {
  deps: Pick<PublishCredentialReadDeps, "matchingCredentialProviderIds">; workspaceId: string; registry: DeployTargetRegistry;
  cache: { delete(input: { workspaceId: string; target: string }): void };
  before?: { credentialType: "vendor" | "custom"; worksFor: string[] };
  after?: { credentialType: "vendor" | "custom"; worksFor: string[] };
}, _options = {}): void {
  const hosts = (value: typeof before) => value ? publishHostsForCredential({ deps, registry,
    credential: { kind: "vendor", provider: null, label: "", meta: { credentialType: value.credentialType, worksFor: value.worksFor } } }) : [];
  const previous = new Set(hosts(before));
  const next = new Set(hosts(after));
  for (const target of new Set([...previous, ...next])) if (previous.has(target) !== next.has(target)) cache.delete({ workspaceId, target });
}

export function providerContract({ registry, providerId }: { registry: DeployTargetRegistry; providerId: string }, _options = {}) {
  const spec = registry.get(providerId)?.descriptor.credential;
  return spec ? { id: providerId, vendorId: spec.vendorId,
    acceptsCustomToken: !spec.fields.some(field => field.required && field.name !== spec.tokenField) } : null;
}
function vaultSummary({ summary, hint, providerId, publishHosts = [], defaultFor = [] }: {
  summary: VaultSummary; hint: CredentialVaultBinding["hint"]; providerId: PublishProviderId; publishHosts?: string[]; defaultFor?: string[];
}, _options = {}): PublishCredentialSummary {
  const tokenHint = hint({ record: summary });
  return { id: summary.id, providerId, vendorId: summary.provider ?? providerId, label: summary.label, configured: true,
    credentialType: summary.meta.credentialType as "vendor" | "custom", worksFor: [...summary.meta.worksFor as string[]],
    publishHosts, defaultFor, isDefault: defaultFor.includes(providerId), tokenTail: tokenHint?.last4 ?? "", tokenHint,
    accountLabel: typeof summary.meta.accountLabel === "string" ? summary.meta.accountLabel : null,
    createdAt: summary.createdAt, updatedAt: summary.updatedAt };
}
/** The vault/scope/hint collaborator a credential repo carries, bound to that repo's own vault rows where the
 * host composition root builds the repo. Policy (the host's credential kinds, owner key, typed storage errors) lives with
 * the binding's owner; this store only says which typed error a storage failure becomes. */
interface CredentialVaultBinding {
  open(required: { repo: { vault?: VaultRepoPort }; sealer?: SecretSealerPort; keyring?: KeyringPort; clock?: ClockPort; idGen?: { newId(): string }; storageError: () => Error }, optional?: Record<string, never>): SecretsVaultService;
  scope(required: { workspaceId: string; kind: "vendor" | "custom"; id?: string }, optional?: Record<string, never>): VaultContext & { id?: string };
  hint(required: { record: Pick<VaultSummary, "tokenLength" | "last4"> }, optional?: Record<string, never>): CredentialTokenHint | null;
}
/** The host's vendor row as this store reads it: the core record plus the safe hint the adapter attaches. */
export type VendorCredentialSetRecord = CoreVendorRecord & { readonly tokenHint?: CredentialTokenHint | null };
/** The host's vendor repo as this store reads it (structurally; the composition root supplies the real one). */
export interface VendorCredentialSetRepoPort extends CoreVendorRepo {
  readonly vault?: VaultRepoPort;
  /** Absent only on a hand-built fake; every store read or write then refuses as an unconfigured vault. */
  readonly credentialVault?: CredentialVaultBinding;
  readonly project?: { readonly workspaceId: string; readonly repo: VendorCredentialSetRepoPort; readonly createRepo?: VendorCredentialSetRepoPort;
    readonly replaceRepo?: VendorCredentialSetRepoPort; readonly sealer: SecretSealerPort; readonly keyring: KeyringPort };
}
/** The repo's host-bound vault collaborator; a repo without one refuses exactly as a repo without a vault did. */
export function bound(deps: { repo: Pick<VendorCredentialSetRepoPort, "credentialVault"> }, _options = {}): CredentialVaultBinding {
  if (!deps.repo.credentialVault) throw new VaultError({ code: "invalid-record" });
  return deps.repo.credentialVault;
}
export function vault(deps: PublishCredentialReadDeps & Partial<PublishCredentialWriteDeps>, _options = {}) {
  return bound(deps).open({ ...deps, storageError: () => new PublishCredentialSecretStoreUnconfiguredError(deps.storageMessage) });
}
export interface PublishCredentialReadDeps {
  readonly ownerKey: string;
  readonly projectWorkspaceId: string;
  readonly storageMessage: string;
  readonly CredentialInputError: abstract new (...args: never[]) => Error;
  readonly ProjectKeyCreateConflictError: abstract new (...args: never[]) => Error;
  readonly normalizeCredentialToken: (required: { value: unknown; field?: string; hosted?: boolean }, optional?: Record<string, never>) => string;
  readonly assertCredentialFreeField: (required: { value: string; field: string }) => void;
  readonly normalizeCredentialWorksFor: (required: { value: unknown }, optional?: Record<string, never>) => string[];
  readonly matchingCredentialProviderIds: (required: { credential: { kind: string; provider: string | null; meta: { credentialType?: unknown; worksFor?: unknown } };
    providers: readonly { id: string; vendorId: string; acceptsCustomToken: boolean }[] }, optional?: Record<string, never>) => string[];
  readonly selectCredentialForProvider: <T extends { kind: string; provider: string | null; meta: { credentialType?: unknown; worksFor?: unknown }; id: string; isDefault: boolean }>(required: {
    credentials: readonly T[]; provider: { id: string; vendorId: string; acceptsCustomToken: boolean }; id?: string }, optional?: Record<string, never>) => T | null;
  readonly credentialScopes: <D extends PublishCredentialReadDeps>(required: { deps: D; workspaceId: string }, optional?: Record<string, never>) => ScopedCredentialDeps<D>[];
  readonly credentialCreateTarget: <D extends PublishCredentialReadDeps>(required: { deps: D; input: { workspaceId: string; scope?: unknown }; invalid: (message: string) => Error }, optional?: Record<string, never>) => ScopedCredentialDeps<D>;
  readonly parseStoreMeta: (required: { kind: "vendor"; meta: VaultSummary["meta"]; provider: string | null }) => Readonly<Record<string, unknown>>;
  repo: VendorCredentialSetRepoPort;
  sealer?: SecretSealerPort;
  loadDeployTargets({ workspaceId }: { workspaceId: string }, optional?: Record<string, never>): Promise<DeployTargetRegistry>;
}

/** The store a listed row came from: rows carry their own store's workspace id. */
export function scopeOfRow<D extends PublishCredentialReadDeps>(deps: D, input: { workspaceId: string; row: { workspaceId: string } }): ScopedCredentialDeps<D> {
  const scopes = deps.credentialScopes({ deps, workspaceId: input.workspaceId });
  const scope = scopes.find(scoped => scoped.workspaceId === input.row.workspaceId) ?? scopes[0];
  if (scope === undefined) throw new Error("Publish credential has no storage scope");
  return scope;
}

/** The vendor row with this id, from the first store holding it (ids are unique across both). @complexity O(scopes). */
async function locateById<D extends PublishCredentialReadDeps>(deps: D, input: { workspaceId: string; id: string }): Promise<{ scoped: ScopedCredentialDeps<D>; existing: VendorCredentialSetRecord } | null> {
  for (const scoped of deps.credentialScopes({ deps, workspaceId: input.workspaceId })) {
    const existing = await scoped.deps.repo.findById({ workspaceId: scoped.workspaceId, id: input.id });
    if (existing) return { scoped, existing };
  }
  return null;
}

/** A site row overrides the project row it would collide with: custom keys share one label space,
 *  vendor keys one per vendor (the vault's own unique-label scopes). */
const labelKey = (row: VaultSummary): string => row.meta.credentialType === "custom" ? `custom\0${row.label}` : `vendor\0${row.provider}\0${row.label}`;

/** Every row this site can publish with: its own, then the project's whose label no site row claims.
 * @complexity O(rows); one inventory per store, no row is opened.
 */
export async function inventory({ deps, workspaceId }: { deps: PublishCredentialReadDeps; workspaceId: string }, _options = {}): Promise<VaultSummary[]> {
  const rows: VaultSummary[] = [];
  const claimed = new Set<string>();
  for (const scoped of deps.credentialScopes({ deps, workspaceId })) {
    const own = await storeInventory({ deps: scoped.deps, workspaceId: scoped.workspaceId });
    rows.push(...own.filter(row => !claimed.has(labelKey(row))));
    for (const row of own) claimed.add(labelKey(row));
  }
  return rows;
}

/** One authorized, metadata-only inventory of one store for both subtypes. No secret is opened, and an
 * injected port cannot widen the workspace/owner/binding. Jini parses every canonical row before matching.
 * @complexity O(rows + metadata); two scoped reads during rollout, no per-row queries.
 */
async function storeInventory({ deps, workspaceId }: { deps: PublishCredentialReadDeps; workspaceId: string }, _options = {}): Promise<VaultSummary[]> {
  const service = vault(deps);
  const unified = await service.list(bound(deps).scope({ workspaceId, kind: "vendor" }));
  const legacy = await service.list(bound(deps).scope({ workspaceId, kind: "custom" }));
  return [...unified, ...legacy]
    .filter(row => {
      if (row.workspaceId !== workspaceId || (row.kind !== "vendor" && row.kind !== "custom")) return false;
      return row.ownerKey === deps.ownerKey && row.principalId === null && row.binding === null && row.configured;
    });
}

/** Safe publish inventory; empty compatibility stays editable on vendor cards. Display host
 * fallback is used only for editing, never for runtime eligibility. Defaults are selected per host.
 * @complexity O(rows × hosts), one metadata inventory and one catalog load.
 */
export async function listPublishCredentials(deps: PublishCredentialReadDeps, input: { workspaceId: UUID }): Promise<PublishCredentialSummary[]> {
  const registry = await deps.loadDeployTargets({ workspaceId: input.workspaceId });
  const rows = await inventory({ deps, workspaceId: input.workspaceId });
  const defaults = new Map<string, string>();
  for (const { descriptor } of registry.list()) {
    const provider = providerContract({ registry, providerId: descriptor.id });
    const selected = provider && selectPublishCredential({ deps, registry, credentials: rows, provider });
    if (selected) defaults.set(descriptor.id, selected.id);
  }
  return rows.flatMap(row => {
    const publishHosts = publishHostsForCredential({ deps, credential: row, registry });
    const providerId = publishHosts[0] ?? (row.meta.credentialType === "vendor"
      ? registry.list().find(target => target.descriptor.credential?.vendorId === row.provider)?.descriptor.id : undefined);
    if (providerId === undefined) return [];
    const defaultFor = [...defaults].filter(([, id]) => id === row.id).map(([host]) => host);
    const summary = vaultSummary({ summary: row, hint: bound(deps).hint, providerId, publishHosts, defaultFor });
    const vendorId = row.provider ?? registry.get(providerId)?.descriptor.credential?.vendorId;
    if (vendorId === undefined) throw new Error(`Publish target ${providerId} has no credential vendor`);
    return [{ ...summary, vendorId, ...reportedScope({ deps, workspaceId: input.workspaceId, row }) }];
  });
}

/** The summary's `scope`, only where a project store is attached (a site-only server's output is unchanged). */
function reportedScope({ deps, workspaceId, row }: { deps: PublishCredentialReadDeps; workspaceId: string; row: VaultSummary }, _options = {}): { scope?: PublishCredentialScope } {
  return deps.repo.project ? { scope: scopeOfRow(deps, { workspaceId, row }).scope } : {};
}

/** Metadata-only ID projection; custom keys keep their existing custom edit/permission boundary. */
export async function describeCredential(deps: PublishCredentialReadDeps, input: { workspaceId: UUID; id: UUID }): Promise<PublishCredentialSummary | null> {
  return (await listPublishCredentials(deps, input)).find(row => row.id === input.id) ?? null;
}

export interface PublishCredentialWriteDeps extends PublishCredentialReadDeps {
  sealer: SecretSealerPort;
  keyring: KeyringPort;
  clock: ClockPort;
  idGen: { newId(): string };
  /** Set only by the submitted human card; the owner port rechecks its current site grant. */
  allowSharedKeyReplacement?: boolean;
}

export interface CreatePublishCredentialInput {
  workspaceId: UUID;
  label: unknown;
  connection: unknown;
  /** `true` makes this the vendor's default connection (clearing any previous one — see
   *  `VendorCredentialSetRepoPort`'s own header). Omitted auto-defaults the vendor's FIRST saved
   *  connection; explicit `false` opts out. Jini owns atomic auto-defaulting. */
  isDefault?: unknown;
  worksFor?: unknown;
  /** `"site"` = a site-owned key. Omitted (or `"project"`) = the project store when one is
   *  attached, visible to attached sites only; this site's vault otherwise. */
  scope?: unknown;
}

/**
 * A project row whose vendor and label this site already uses would be hidden here by the site row
 * (site rows override), so the save would look lost: refused as the same duplicate as within one store.
 */
async function assertLabelFreeOnSite({ deps, target, workspaceId, vendorId, label, providerId }: { deps: PublishCredentialReadDeps;
  target: ScopedCredentialDeps<unknown>; workspaceId: string; vendorId: string; label: string; providerId: string }, _options = {}): Promise<void> {
  if (target.scope !== "project") return;
  if ((await deps.repo.listByVendor({ workspaceId, vendorId })).some(row => row.label === label)) {
    throw new PublishCredentialDuplicateLabelError(`a '${providerId}' credential labeled '${label}' already exists in this workspace`);
  }
}

/** Label conflicts keep the feature's error contract; stale CAS failures stay conflicts.
 * Callers choose the row id before writing, including when the vault could generate one.
 * @complexity One vault write; a failed update adds one selected row read, never an inventory scan. */
async function saveConnection({ target, input, providerId }: { target: ScopedCredentialDeps<PublishCredentialWriteDeps>;
  input: Parameters<ReturnType<typeof vault>["put"]>[0] & { id: string }; providerId: PublishProviderId }, _options = {}): Promise<VaultSummary> {
  try { return await vault(target.deps).put(input); }
  catch (error) {
    if (error instanceof target.deps.ProjectKeyCreateConflictError) throw new PublishCredentialDuplicateLabelError(error.message);
    // Unattached project rows are hidden from normal reads. Compare only this row's revision to
    // distinguish a duplicate label from a CAS conflict; never enumerate, attach or open other keys.
    // The storage kernel recognizes UNIQUE (workspace_id, vendor_id, label) via SQLite's
    // code/message or Postgres SQLSTATE 23505.
    const duplicate = await isPublishLabelConflict({ error, target, input });
    if (duplicate) throw new PublishCredentialDuplicateLabelError(input.workspaceId === target.deps.projectWorkspaceId ? `Your project already has a key named '${input.label}'. Use it here, or pick another name.` : `a '${providerId}' credential labeled '${input.label}' already exists in this workspace`);
    throw error;
  }
}

/** Distinguish duplicate labels from stale CAS without enumerating hidden owner keys.
 * @returns Whether this is a duplicate label rather than a stale compare-and-set.
 * @complexity O(1); a failed update reads one selected metadata row, creates read none.
 */
async function isPublishLabelConflict({ error, target, input }: { error: unknown; target: ScopedCredentialDeps<PublishCredentialWriteDeps>;
  input: Parameters<ReturnType<typeof vault>["put"]>[0] & { id: string } }, _options = {}): Promise<boolean> {
  if (isUniqueViolation({ err: error })) return true;
  if (!(error instanceof VaultError) || error.code !== "conflict") return false;
  if (input.expectedRevision === null) return true;
  return currentPublishLabelConflict({ target, input });
}

async function currentPublishLabelConflict({ target, input }: {
  target: ScopedCredentialDeps<PublishCredentialWriteDeps>;
  input: Parameters<ReturnType<typeof vault>["put"]>[0] & { id: string };
}): Promise<boolean> {
  if (!target.deps.repo.vault) throw new VaultError({ code: "invalid-record" });
  const current = await target.deps.repo.vault.find({ workspaceId: input.workspaceId, id: input.id });
  if (!current || current.revision !== input.expectedRevision) return false;
  // The unique label belongs to its provider, so moving providers can conflict without a rename.
  return current.label !== input.label || (input.provider !== undefined && current.provider !== input.provider);

}

/** Validate before the vault write. Jini atomically auto-defaults the first vendor credential. */
export async function createPublishCredential(deps: PublishCredentialWriteDeps, input: CreatePublishCredentialInput): Promise<PublishCredentialSummary> {
  const label = validateLabel({ deps, raw: input.label });
  const registry = await deps.loadDeployTargets({ workspaceId: input.workspaceId });
  const validated = validateConnection({ deps, raw: input.connection, registry });
  const isDefault = optionalBoolean({ raw: input.isDefault, field: "isDefault" });
  const { providerId, ...fields } = validated.connection;
  // Project-first (`@jini-ai/integrations/vendor-credentials/project-scope`); "site" = only for this site.
  const target = deps.credentialCreateTarget({ deps, input, invalid: message => new PublishCredentialValidationError(message) });
  await assertLabelFreeOnSite({ deps, target, workspaceId: input.workspaceId, vendorId: validated.spec.vendorId, label, providerId });
  const summary = await saveConnection({ target, providerId, input: {
    ...bound(target.deps).scope({ workspaceId: target.workspaceId, kind: "vendor" }), id: deps.idGen.newId(), expectedRevision: null,
    provider: validated.spec.vendorId, label, meta: { credentialType: "vendor", worksFor: validatedWorksFor({ deps, value: input.worksFor === undefined ? registry.get(providerId)?.module.defaultCredentialWorksFor ?? [validated.spec.vendorId] : input.worksFor }), accountLabel: null }, payload: { vendorId: validated.spec.vendorId, ...fields },
    ...hintTokenOf({ fields, tokenField: validated.spec.tokenField }), ...(isDefault === undefined ? {} : { isDefault }),
  } });
  // The project read view deliberately hides this new row until it is attached; use put's result.
  const publishHosts = publishHostsForCredential({ deps, credential: summary, registry });
  return { ...vaultSummary({ summary, hint: bound(target.deps).hint, providerId, publishHosts, defaultFor: summary.isDefault ? publishHosts : [] }), ...reportedScope({ deps, workspaceId: input.workspaceId, row: summary }) };
}

export interface UpdatePublishCredentialInput {
  workspaceId: UUID;
  id: UUID;
  /** Omitted = leave the label unchanged. */
  label?: unknown;
  /** Omitted = leave the stored connection (and its vendor) untouched — this route's own
   *  "connection omitted => keep the stored secret untouched" contract. Supplying a NEW connection
   *  may change the host and vendor. A provider-only move between token-only hosts retains the
   *  envelope: vault AAD binds the stable identity, not the vendor. Explicit secrets rotate.
   *  On same-vendor updates, null removes an optional secret; blank keeps it. */
  connection?: unknown;
  /** `true` makes this the default connection for its (possibly new — see `connection` above)
   *  vendor, clearing any previous default in the same repo call. Omitted/`false` preserves a
   *  same-vendor default; moves use the destination's default/first-row rule. Use
   *  `createPublishCredential`/another `updatePublishCredential` call with `isDefault: true` to
   *  promote a different row instead. */
  isDefault?: unknown;
  worksFor?: unknown;
}

/** Select the trusted owner-card writer without widening the site's read view.
 * @returns The existing scope for local/legacy stores; otherwise the grant-checked writer.
 * @throws PublishCredentialValidationError outside a submitted human card.
 * @complexity O(1); no I/O, inventories or secret material.
 */
function sharedReplacementScope({ deps, scoped }: { deps: PublishCredentialWriteDeps; scoped: ScopedCredentialDeps<PublishCredentialWriteDeps> }, _options = {}): ScopedCredentialDeps<PublishCredentialWriteDeps> {
  const project = deps.repo.project;
  if (scoped.scope !== "project" || !project?.createRepo) return scoped;
  if (!deps.allowSharedKeyReplacement || !project.replaceRepo) throw new PublishCredentialValidationError("Change this saved key in Shared Keys, or open its secure key card in the owner session. Details: P25_OWNER_KEY_READ_ONLY.");
  return { ...scoped, deps: { ...scoped.deps, repo: project.replaceRepo } };
}

/** Blank secret fields keep their stored value; null explicitly removes an optional secret.
 * Required secrets remain required, and non-secret companion fields still update.
 * @complexity O(fields + sealed payload bytes), at most one existing connection open.
 */
async function updatedConnection({ deps, input, existing, registry, host }: { deps: PublishCredentialWriteDeps; input: UpdatePublishCredentialInput;
  existing: VendorCredentialSetRecord; registry: DeployTargetRegistry; host: PublishProviderId }, _options = {}): Promise<ValidatedConnection> {
  const raw = input.connection;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return validateConnection({ deps, raw, registry });
  const values = raw as Record<string, unknown>;
  const { spec } = connectionCredentialSpec({ value: values, registry });
  if (spec.vendorId !== existing.vendorId) return validateConnection({ deps, raw, registry });
  const blankSecrets = spec.fields.filter(field => isSecretField({ field, spec }) && (values[field.name] === "" || values[field.name] === undefined));
  const clearedSecrets = spec.fields.filter(field => isSecretField({ field, spec }) && !field.required && field.name !== spec.tokenField && values[field.name] === null);
  if (blankSecrets.length === 0 && clearedSecrets.length === 0) return validateConnection({ deps, raw, registry });
  const stored = await decryptRecord({ deps, record: existing, providerId: host });
  const merged = { ...stored, ...values };
  for (const field of blankSecrets) merged[field.name] = stored[field.name];
  for (const field of clearedSecrets) delete merged[field.name];
  return validateConnection({ deps, raw: merged, registry });
}

/** Omitted connections retain their sealed envelope/hints and never require a site key.
 * Provider moves retarget the old compatibility IDs unless the caller supplies worksFor.
 * Reject labels that would hide a project row behind a site's row before writing.
 */
export async function updatePublishCredential(deps: PublishCredentialWriteDeps, input: UpdatePublishCredentialInput): Promise<PublishCredentialSummary> {
  // Changed where it lives: this site's own row, else the project's (shared by every site).
  const located = await locateById(deps, input);
  const registry = await deps.loadDeployTargets({ workspaceId: input.workspaceId });
  const host = located ? registry.list().find(target => target.descriptor.credential?.vendorId === located.existing.vendorId)?.descriptor.id : undefined;
  if (!located || host === undefined) throw new PublishCredentialNotFoundError(`no publish credential '${input.id}' in this workspace`);
  const { existing } = located;
  const scoped = sharedReplacementScope({ deps, scoped: located.scoped });
  const label = input.label !== undefined ? validateLabel({ deps, raw: input.label }) : existing.label;
  const requestedDefault = optionalBoolean({ raw: input.isDefault, field: "isDefault" });
  if (!scoped.deps.repo.vault) throw new VaultError({ code: "invalid-record" });
  const row = await scoped.deps.repo.vault.find({ workspaceId: scoped.workspaceId, id: input.id });
  if (!row) throw new PublishCredentialNotFoundError(`no publish credential '${input.id}' in this workspace`);
  const { providerId, accountLabel, ...changes } = await connectionChanges({ deps: scoped.deps, input, existing, registry, host, row });
  await assertLabelFreeOnSite({ deps, target: scoped, workspaceId: input.workspaceId, vendorId: changes.provider, label, providerId });
  const summary = await saveConnection({ target: scoped, providerId, input: { ...bound(scoped.deps).scope({ workspaceId: scoped.workspaceId, kind: "vendor" }), id: input.id,
    expectedRevision: row.revision, label, ...changes,
    meta: { ...row.meta, worksFor: updatedWorksFor({ deps, value: input.worksFor, row, provider: changes.provider, host }), accountLabel },
    ...(requestedDefault === true ? { isDefault: true } : {}) } });
  const described = await describeCredential(deps, { workspaceId: input.workspaceId, id: summary.id });
  if (!described) throw new PublishCredentialNotFoundError(`saved publish credential '${summary.id}' could not be found`);
  return described;
}

async function connectionChanges({ deps, input, existing, registry, host, row }: {
  deps: PublishCredentialWriteDeps; input: UpdatePublishCredentialInput; existing: VendorCredentialSetRecord;
  registry: DeployTargetRegistry; host: PublishProviderId; row: Pick<VaultSummary, "meta">;
}, _options = {}) {
  const move = preservedMove({ raw: input.connection, registry, host });
  if (input.connection !== undefined && !move) {
    const validated = await updatedConnection({ deps, input, existing, registry, host });
    const { providerId, ...fields } = validated.connection;
    return { providerId, provider: validated.spec.vendorId, accountLabel: null,
      payload: { vendorId: validated.spec.vendorId, ...fields }, ...hintTokenOf({ fields, tokenField: validated.spec.tokenField }) };
  }
  // Payload omission preserves ciphertext/hints; the vault atomically promotes/selects defaults.
  const providerId = move?.providerId ?? host;
  const provider = move?.spec.vendorId ?? existing.vendorId;
  return { providerId, provider, accountLabel: provider === existing.vendorId ? row.meta.accountLabel : null };
}

/** Legacy rows were folded by 0012. Delete only the vault row; reboot has no source to recopy.
 *  A project row is removed only when no other site uses it; its attachments are removed with it. */
export async function deletePublishCredential(deps: {
  repo: Pick<VendorCredentialSetRepoPort, "delete" | "findById" | "project">;
  transaction?: { transaction<T>(fn: () => Promise<T>): Promise<T> };
}, input: { workspaceId: UUID; id: UUID }): Promise<void> {
  const owner = await ownerOf(deps.repo, input);
  await owner.repo.delete({ workspaceId: owner.workspaceId, id: input.id });
}

/**
 * Persists a freshly-verified account label onto an existing row — see this file's own header for
 * why {@link createPublishCredential}/{@link updatePublishCredential} never do this themselves. The
 * ONE intended caller is the admin credential-CRUD route (`server/routes/admin/system/publish-
 * credentials.ts`), immediately after its own `verifyPublishCredentialById` call returns a `"valid"`
 * result carrying an `accountLabel`. Never call this with an EMPTY/absent label to "clear" one: a
 * failed or inconclusive re-verify carries no `accountLabel` at all and must leave a previously-healed
 * value alone — the caller's own `result.accountLabel !== undefined` check enforces that.
 *
 * A targeted single-column write ({@link VendorCredentialSetRepoPort.updateAccountLabel}), not a
 * full-row replace — never touches `sealed`, `isDefault`, or `updatedAt`.
 *
 * Written where the row lives: this site's vault, else the project's.
 *
 * @complexity O(1) — one lookup and one repo write (a no-op, not an error, if the row vanished meanwhile).
 */
export async function healAccountLabel(deps: { repo: VendorCredentialSetRepoPort }, input: { workspaceId: UUID; id: UUID; accountLabel: string }): Promise<void> {
  const owner = await ownerOf(deps.repo, input);
  await owner.repo.updateAccountLabel({ ...input, workspaceId: owner.workspaceId });
}

/** Jini checks exact ownership before opening. Keep the typed error used by HTTP and daemon
 * boundaries: a missing key must not become an unhandled rejection in a publishing process. */
export async function decryptRecord({ deps, record, providerId }: { deps: PublishCredentialResolveDeps; record: VendorCredentialSetRecord; providerId: PublishProviderId }, _options = {}): Promise<PublishConnectionInput> {
  try {
    const resolved = await vault(deps).get({ ...bound(deps).scope({ workspaceId: record.workspaceId, kind: "vendor" }), id: record.id });
    if (!resolved?.payload) throw new PublishCredentialSecretStoreUnconfiguredError(deps.storageMessage);
    const { vendorId: _vendorId, ...fields } = resolved.payload as Record<string, string>;
    return { ...fields, providerId };
  } catch { throw new PublishCredentialSecretStoreUnconfiguredError(deps.storageMessage); }
}

