

import { CREDENTIAL_MESSAGES } from '@jini-ai/platform/secrets/credential-token';
import type { CredentialConnection } from "@jini-ai/core/contracts/site/secrets-credential-token";
import type { Clock as ClockPort, UUID } from "@jini-ai/core/primitives";

import { isUniqueViolation } from "@jini-ai/core/contracts/storage";
import type { KeyringPort } from "@jini-ai/core/contracts/vault";
import type { SecretSealerPort } from "@jini-ai/integrations/secrets";
import { VaultError, type VaultSummary } from "@jini-ai/core/contracts/vault";
import { credentialCreateTarget, credentialScopes, type CredentialScope, type ScopedCredentialDeps } from "@jini-ai/integrations/vendor-credentials/project-scope";
import type { DescriptorI18n } from "@jini-ai/core/text";
import type { SourceControlProviderDescriptor as BaseProviderDescriptor } from "../contracts.js";
import type { SourceControlCredentialForm } from "./credential-form.js";
import type { SourceControlProvider, SourceControlProviderModule, SourceControlKitHttpClient as HttpClientPort } from "./provider-module.js";
import { validateLabel, optionalBoolean, isEmptyTokenPatch, normalizeConnectionPatch, assertBlankPatchChangesNoField, preservedProvider, credentialRegistry, normalizeStoredToken, assertPlainField, validateConnection } from "./store.validation.js";

export type SourceControlProviderDescriptor = Omit<BaseProviderDescriptor, "credential" | "i18n"> & { readonly credential?: SourceControlCredentialForm; readonly i18n?: DescriptorI18n };
export interface SourceControlProviderRegistry {
  list(): readonly { descriptor: SourceControlProviderDescriptor; pluginId: string; module: SourceControlProviderModule }[];
  get(required: { providerId: string }, optional?: Record<string, never>): { descriptor: SourceControlProviderDescriptor; pluginId: string; module: SourceControlProviderModule } | undefined;
  readonly switchedOff?: ReadonlyMap<string, string>;
  readonly refusals: readonly string[];
}
export type LoadSourceControlProviders = (required: { workspaceId: string }, optional?: Record<string, never>) => Promise<SourceControlProviderRegistry>;
import type {
  CredentialVaultBinding,
  SourceControlConnectionInput,
  SourceControlCredentialSetRecord,
  SourceControlCredentialSetRepoPort,
  SourceControlCredentialSummary,
  SourceControlProviderId,
} from "@jini-ai/core/contracts/site/source-control-credentials";


/** Source-control validation and inline identity probes remain feature policy. Jini owns
 * sealing, persistence, hints and defaults. Plain read models require neither keys nor opens.
 * The identity store stays separate from deployments and custom API keys; commit callers may
 * supply the existing custom-key reader through a port when this provider has no identity row. */

export class SourceControlCredentialValidationError extends Error {}

/** A `(workspaceId, providerId, label)` collision — the route maps this to `409 DUPLICATE_LABEL`. */
export class SourceControlCredentialDuplicateLabelError extends Error {}

/** Thrown when `sealer.seal()`/`keyring.activeKey()` fails while writing a connection — the
 *  realistic cause is a missing site key (`TOVU_SITE_KEY`), same fail-closed
 *  contract `PublishCredentialSecretStoreUnconfiguredError` documents for the sibling table. */
export class SourceControlCredentialSecretStoreUnconfiguredError extends Error {}

export class SourceControlCredentialNotFoundError extends Error {}

async function toSummary(record: SourceControlCredentialSetRecord): Promise<SourceControlCredentialSummary> {
  return { id: record.id, providerId: record.providerId, label: record.label, configured: true,
    tokenHint: record.tokenHint ?? null, isDefault: record.isDefault, accountLabel: record.accountLabel,
    createdAt: record.createdAt, updatedAt: record.updatedAt };
}
function vaultSummary({ summary, hint }: { summary: VaultSummary; hint: CredentialVaultBinding["hint"] }, _options = {}): SourceControlCredentialSummary {
  return { id: summary.id, providerId: summary.provider as SourceControlProviderId, label: summary.label,
    configured: true, tokenHint: hint({ record: summary }), isDefault: summary.isDefault,
    accountLabel: summary.meta.accountLabel as string | null, createdAt: summary.createdAt, updatedAt: summary.updatedAt };
}
/** The repo's host-bound vault collaborator; a repo without one refuses exactly as a repo without a vault did. */
function bound(deps: { repo: Pick<SourceControlCredentialSetRepoPort, "credentialVault"> }, _options = {}): CredentialVaultBinding {
  if (!deps.repo.credentialVault) throw new VaultError({ code: "invalid-record" });
  return deps.repo.credentialVault;
}
function vault(deps: SourceControlCredentialReadDeps & Partial<SourceControlCredentialWriteDeps>, _options = {}) {
  return bound(deps).open({ ...deps, storageError: () => new SourceControlCredentialSecretStoreUnconfiguredError(CREDENTIAL_MESSAGES.storage) });
}

/** Error names (and the transport's own wording) that mean the probe ran out of time, not that the host refused it. */
const TIMEOUT_ERROR_NAMES: ReadonlySet<string> = new Set(['AbortError', 'TimeoutError', 'FetchTimeoutError']);

/** What one probe response says about the saved connection: rejected, reachable, or not usable. */
function connectionForStatus({ status }: { status: number }, _optional = {}): CredentialConnection {
  if (status === 401 || status === 403) return 'auth';
  return status >= 200 && status < 300 ? 'connected' : 'unreachable';
}

/** What a probe that never got an answer says about the saved connection. */
function connectionForFailure({ err }: { err: unknown }, _optional = {}): CredentialConnection {
  const timedOut = err instanceof Error && (TIMEOUT_ERROR_NAMES.has(err.name) || /timed out/i.test(err.message));
  return timedOut ? 'timeout' : 'unreachable';
}

/**
 * Best-effort "who does this token belong to" probe, run inline at save time — see this file's own
 * header for why THIS table's `create`/`update` may do this while `publish-credentials/store.ts`'s
 * may not. NEVER throws: no provider, a network failure, timeout, or non-2xx response degrades to
 * `null` (no account label learned) rather than failing the save.
 *
 * The host-specific read lives in the plugin that provides the host (`provider-module.ts`'s
 * `readAccountLabel`; each provider owns its account identity read). A host no enabled
 * plugin provides yields `null` with no request made. The request carries the saved token, so it goes
 * out only through the guarded {@link SourceControlCredentialWriteDeps.httpClient}, never the global
 * `fetch`; without one the provider is built over the kit's refusing stand-in (its request fails as a
 * transport error) and the save still succeeds.
 *
 * @complexity One registry load plus at most one bounded HTTP request.
 */
async function probeAccountLabel({ deps, workspaceId, providerId, token }: { deps: SourceControlCredentialWriteDeps; workspaceId: UUID; providerId: SourceControlProviderId; token: string }, _optional = {}): Promise<{ accountLabel: string | null; connection: CredentialConnection }> {
  let connection: CredentialConnection = 'saved';
  const { httpClient, loadSourceControlProviders } = deps;
  // Write-only callers may omit account discovery; production supplies its boot-bound loader and client.
  if (!loadSourceControlProviders) return { accountLabel: null, connection };
  const observed: HttpClientPort | undefined = httpClient && {
    send: async (request, options) => {
      try {
        const response = await httpClient.send(request, options);
        connection = connectionForStatus({ status: response.status });
        return response;
      } catch (err) {
        connection = connectionForFailure({ err });
        throw err;
      }
    },
  };
  try {
    const built = await deps.buildSourceControlProvider({ load: loadSourceControlProviders, ...(observed ? { httpClient: observed } : {}), workspaceId, providerId });
    const accountLabel = built.ok ? await built.provider.readAccountLabel(token) : null;
    return { accountLabel, connection };
  } catch {
    return { accountLabel: null, connection };
  }
}

export interface SourceControlCredentialReadDeps {
  repo: SourceControlCredentialSetRepoPort;
  sealer?: SecretSealerPort;
}

/** A row and the store holding it (`@jini-ai/integrations/vendor-credentials/project-scope`: this site's own vault first,
 *  then the project half `types.ts`'s `repo.project` attaches), with the deps that open it. */
interface Located<D> { readonly scoped: ScopedCredentialDeps<D>; readonly record: SourceControlCredentialSetRecord }

/** The summary's `scope`, only where a project store is attached (a site-only server's output is unchanged). */
const reportedScope = (deps: SourceControlCredentialReadDeps, scoped: ScopedCredentialDeps<unknown>): { scope?: CredentialScope } =>
  deps.repo.project ? { scope: scoped.scope } : {};

/** The row with this id, from the first store holding it (ids are unique across both). @complexity O(scopes). */
async function locateById<D extends SourceControlCredentialReadDeps>(deps: D, input: { workspaceId: UUID; id: UUID }): Promise<Located<D> | null> {
  for (const scoped of credentialScopes({ deps, workspaceId: input.workspaceId })) {
    const record = await scoped.deps.repo.findById({ workspaceId: scoped.workspaceId, id: input.id });
    if (record) return { scoped, record };
  }
  return null;
}

/**
 * Every row this site uses: its own rows, then project rows whose host and label no site row already
 * claims (a site row of the same host and label is the override).
 * @complexity O(n) in the two stores' (small) credential counts; no row is opened.
 */
async function listEffective<D extends SourceControlCredentialReadDeps>(deps: D, workspaceId: UUID): Promise<Located<D>[]> {
  const found: Located<D>[] = [];
  const claimed = new Set<string>();
  for (const scoped of credentialScopes({ deps, workspaceId })) {
    const records = await scoped.deps.repo.listByWorkspace({ workspaceId: scoped.workspaceId });
    for (const record of records.filter((row) => !claimed.has(`${row.providerId}\0${row.label}`))) found.push({ scoped, record });
    for (const record of records) claimed.add(`${record.providerId}\0${record.label}`);
  }
  return found;
}

/**
 * The read model for ONE credential set. Pure DB read — no sealer, no keyring, cannot fail on a
 * misconfigured site key. Returns `null` if no row exists for `(workspaceId, id)` (not an
 * error — the caller decides whether that is a 404).
 *
 * @complexity O(1) — one `findById` lookup.
 */
export async function describeCredential(
  deps: SourceControlCredentialReadDeps,
  input: { workspaceId: UUID; id: UUID }
): Promise<SourceControlCredentialSummary | null> {
  const located = await locateById(deps, input);
  return located ? { ...await toSummary(located.record), ...reportedScope(deps, located.scoped) } : null;
}

/**
 * The read model for EVERY credential set a workspace has saved — what
 * `GET .../source-control/credentials` returns. Same "never decrypts" contract as
 * {@link describeCredential}.
 *
 * @complexity O(n) in the workspace's own (small) credential-set count. One repo read, one array
 *   map, no per-row I/O.
 */
export async function listSourceControlCredentials(
  deps: SourceControlCredentialReadDeps,
  input: { workspaceId: UUID }
): Promise<SourceControlCredentialSummary[]> {
  const located = await listEffective(deps, input.workspaceId);
  const legacy = await Promise.all(located.map(async ({ scoped, record }) => ({ ...await toSummary(record), ...reportedScope(deps, scoped) })));
  // Canonical keys live in the provider-declared key store; neither half opens a key for display.
  const canonical = await deps.repo.canonical?.list({ workspaceId: input.workspaceId }) ?? [];
  const seen = new Set(legacy.map(row => row.id));
  return [...legacy, ...canonical.filter(row => !seen.has(row.id) && seen.add(row.id))];
}

export interface SourceControlCredentialWriteDeps extends SourceControlCredentialReadDeps {
  assertCredentialFreeField: (required: { value: string; field: string }, optional?: Record<string, never>) => void;
  isProjectKeyCreateConflictError: (error: unknown) => error is Error;
  buildSourceControlProvider: (required: { load: LoadSourceControlProviders; httpClient?: HttpClientPort; workspaceId: string; providerId: string }) => Promise<{ ok: true; provider: Pick<SourceControlProvider, "readAccountLabel"> } | { ok: false; message: string }>;
  sealer: SecretSealerPort;
  keyring: KeyringPort;
  clock: ClockPort;
  idGen: { newId(): string };
  /** The guarded client (egress policy, redirects per call) for the save-time identity probe, which
   *  carries the saved token. Absent: the provider's request fails as a transport error (no global `fetch`).
   *  Its outbound span is recorded where the client is built. */
  httpClient?: HttpClientPort;
  /** Loaded provider declarations govern admission and optional account-label discovery. */
  loadSourceControlProviders?: LoadSourceControlProviders;
}

/** True iff `err` is the label's UNIQUE `(workspace_id, provider_id, label)` index rejecting a
 *  duplicate, on any database (`isUniqueViolation`, storage kernel: SQLite's code/message, Postgres
 *  SQLSTATE 23505). */
export function isUniqueLabelViolation({ err }: { err: unknown }, _optional = {}): boolean {
  return isUniqueViolation({ err });
}

export interface CreateSourceControlCredentialInput {
  workspaceId: UUID;
  label: unknown;
  connection: unknown;
  /** `true` makes this the provider's default connection. Omitted auto-defaults the provider's
   *  FIRST saved connection; explicit `false` opts out. Jini owns atomic auto-defaulting. */
  isDefault?: unknown;
  /** `"site"` = a site-owned key. Omitted (or `"project"`) = the project store when one is
   *  attached, visible to attached sites only; this site's vault otherwise. */
  scope?: unknown;
}

/**
 * A project row whose host and label this site already uses would be hidden here by the site row
 * (site rows override), so the save would look lost: refused as the same duplicate as within one store.
 */
async function assertLabelFreeOnSite({ deps, target, workspaceId, providerId, label }: { deps: SourceControlCredentialReadDeps;
  target: ScopedCredentialDeps<unknown>; workspaceId: UUID; providerId: SourceControlProviderId; label: string }, _options = {}): Promise<void> {
  if (target.scope !== "project") return;
  if ((await deps.repo.listByProvider({ workspaceId, providerId })).some(row => row.label === label)) {
    throw new SourceControlCredentialDuplicateLabelError(`a '${providerId}' credential labeled '${label}' already exists in this workspace`);
  }
}

/** A rename or host move of a project row is checked as a create is: a label this site's own row
 * already uses would hide the moved row here. An unchanged label and host needs no check. */
async function assertMoveFreeOnSite({ deps, scoped, existing, workspaceId, providerId, label }: { deps: SourceControlCredentialReadDeps;
  scoped: ScopedCredentialDeps<unknown>; existing: SourceControlCredentialSetRecord; workspaceId: UUID; providerId: SourceControlProviderId; label: string }, _options = {}): Promise<void> {
  if (label === existing.label && providerId === existing.providerId) return;
  await assertLabelFreeOnSite({ deps, target: scoped, workspaceId, providerId, label });
}

/** Validate the loaded declaration, then make the secret durable before identity discovery.
 * @param required Explicit store ports and create input. @returns A summary with no secret fields.
 * @throws {SourceControlCredentialValidationError} Invalid or unavailable provider/fields.
 * Probe failures never undo a save; Jini owns sealing, hints and atomic defaults. */
export async function createSourceControlCredential(
  { deps, input }: { deps: SourceControlCredentialWriteDeps; input: CreateSourceControlCredentialInput },
  _options = {},
): Promise<SourceControlCredentialSummary> {
  const label = validateLabel({ raw: input.label, assertCredentialFreeField: deps.assertCredentialFreeField });
  const connection = validateConnection({ raw: input.connection, registry: await credentialRegistry({ deps, workspaceId: input.workspaceId }), assertCredentialFreeField: deps.assertCredentialFreeField });
  const canonical = deps.repo.canonical;
  if (canonical?.supports({ providerId: connection.providerId })) {
    if (!canonical.create) throw new SourceControlCredentialValidationError("Open the provider's API key card to save this shared key.");
    return canonical.create({ workspaceId: input.workspaceId, connection });
  }
  const isDefault = optionalBoolean({ raw: input.isDefault, field: "isDefault" });
  // Project-first (`@jini-ai/integrations/vendor-credentials/project-scope`); "site" = only for this site.
  const target = credentialCreateTarget({ deps, input, invalid: message => new SourceControlCredentialValidationError(message) });
  await assertLabelFreeOnSite({ deps, target, workspaceId: input.workspaceId, providerId: connection.providerId, label });
  const id = deps.idGen.newId();
  const summary = await saveConnection({ deps: target.deps, input: { ...bound(target.deps).scope({ workspaceId: target.workspaceId, kind: "source-control", id }),
    id, provider: connection.providerId, label, expectedRevision: null, payload: { ...connection }, hintToken: connection.token,
    meta: { accountLabel: null }, ...(isDefault === undefined ? {} : { isDefault }) } });
  return { ...await probeSavedConnection({ deps: target.deps, summary, connection, workspaceId: input.workspaceId }), ...reportedScope(deps, target) };
}

/** Conflict translation is label-specific; a CAS conflict is never reported as a duplicate. */
async function saveConnection({ deps, input }: { deps: SourceControlCredentialWriteDeps; input: Parameters<ReturnType<typeof vault>["put"]>[0] }, _options = {}): Promise<VaultSummary> {
  try { return await vault(deps).put(input); }
  catch (error) {
    if (deps.isProjectKeyCreateConflictError(error)) throw new SourceControlCredentialDuplicateLabelError(error.message);
    const duplicate = isUniqueLabelViolation({ err: error }) || error instanceof VaultError && error.code === "conflict" &&
      (await deps.repo.listByProvider({ workspaceId: input.workspaceId, providerId: input.provider as SourceControlProviderId }))
        .some(row => row.id !== input.id && row.label === input.label);
    if (duplicate) throw new SourceControlCredentialDuplicateLabelError(input.workspaceId === 'project' ? `Your project already has a key named '${input.label}'. Use it here, or pick another name.` : `a '${input.provider}' credential labeled '${input.label}' already exists in this workspace`);
    throw error;
  }
}

/** `deps` writes the store holding `summary`'s row; `workspaceId` is the site's (its provider registry). */
async function probeSavedConnection({ deps, summary, connection, workspaceId }: { deps: SourceControlCredentialWriteDeps; summary: VaultSummary; connection: SourceControlConnectionInput; workspaceId: UUID }, _options = {}): Promise<SourceControlCredentialSummary> {
  const probe = await probeAccountLabel({ deps, workspaceId, providerId: connection.providerId, token: connection.token });
  try { if (probe.accountLabel !== null) assertPlainAccountLabel({ value: probe.accountLabel, assertCredentialFreeField: deps.assertCredentialFreeField }); } catch { probe.accountLabel = null; }
  if (probe.accountLabel !== null) {
    // This is the saved revision, not a new read's revision: an old probe must not heal a rotation.
    try {
      if (!deps.repo.vault) throw new Error("Source control credential has no vault");
      await deps.repo.vault.patchMeta({ workspaceId: summary.workspaceId, id: summary.id,
      expectedRevision: summary.revision, patch: { accountLabel: assertPlainAccountLabel({ value: probe.accountLabel, assertCredentialFreeField: deps.assertCredentialFreeField }) }, updatedAt: summary.updatedAt }); }
    catch { /* A metadata failure does not undo the saved token. */ }
  }
  return { ...vaultSummary({ summary, hint: bound(deps).hint }), accountLabel: probe.accountLabel, connection: probe.connection };
}
function assertPlainAccountLabel({ value, assertCredentialFreeField }: { value: string; assertCredentialFreeField: SourceControlCredentialWriteDeps["assertCredentialFreeField"] }, _options = {}): string {
  assertPlainField({ value, field: "accountLabel", assertCredentialFreeField });
  return value;
}

export interface UpdateSourceControlCredentialInput {
  workspaceId: UUID;
  id: UUID;
  /** Omitted = leave the label unchanged. */
  label?: unknown;
  /** Omitted = leave the stored connection (and its provider) untouched. */
  connection?: unknown;
  /** `true` selects the destination default. Omitted/`false` preserves a same-provider default;
   * a move uses the destination group's default/first-row rule. */
  isDefault?: unknown;
}

async function loadSourceControlCredentialUpdate({ deps, input }: { deps: SourceControlCredentialWriteDeps; input: UpdateSourceControlCredentialInput }) {
  // Changed where it lives: this site's own row, else the project's attached row.
  const located = await locateById(deps, input);
  if (!located) throw new SourceControlCredentialNotFoundError(`no source control credential '${input.id}' in this workspace`);
  const { scoped, record: existing } = located;
  const label = input.label !== undefined ? validateLabel({ raw: input.label, assertCredentialFreeField: deps.assertCredentialFreeField }) : existing.label;
  const requestedDefault = optionalBoolean({ raw: input.isDefault, field: "isDefault" });
  if (!scoped.deps.repo.vault) throw new SourceControlCredentialSecretStoreUnconfiguredError(CREDENTIAL_MESSAGES.storage);
  const row = await scoped.deps.repo.vault.find({ workspaceId: scoped.workspaceId, id: input.id });
  if (!row) throw new SourceControlCredentialNotFoundError(`no source control credential '${input.id}' in this workspace`);
  const where = bound(scoped.deps).scope({ workspaceId: scoped.workspaceId, kind: "source-control" });
  return { scoped, existing, label, requestedDefault, row, where };
}

/** Omitted/blank tokens keep the envelope; explicit rotations reset and re-probe the label.
 * @param required Explicit store ports and update input. @returns A summary with no secret fields.
 * @throws {SourceControlCredentialValidationError} Invalid or unavailable destination/fields.
 * Metadata updates for an unchanged opaque id need neither a provider nor decryption. */
export async function updateSourceControlCredential(
  { deps, input }: { deps: SourceControlCredentialWriteDeps; input: UpdateSourceControlCredentialInput },
  _options = {},
): Promise<SourceControlCredentialSummary> {
  // Only an id the canonical store does not own reaches the legacy path; owned refusals throw there.
  const canonical = await deps.repo.canonical?.update({ workspaceId: input.workspaceId, id: input.id,
    patch: { label: input.label, connection: input.connection, isDefault: input.isDefault } });
  if (canonical?.owned) return canonical.summary;
  const { scoped, existing, label, requestedDefault, row, where } = await loadSourceControlCredentialUpdate({ deps, input });
  const patch = await normalizeConnectionPatch({ raw: input.connection, existing: existing.providerId, registry: () => credentialRegistry({ deps, workspaceId: input.workspaceId }) });
  if (patch !== undefined && !isEmptyTokenPatch({ value: patch })) {
    const connection = validateConnection({ raw: patch, registry: await credentialRegistry({ deps, workspaceId: input.workspaceId }), assertCredentialFreeField: deps.assertCredentialFreeField });
    await assertMoveFreeOnSite({ deps, scoped, existing, workspaceId: input.workspaceId, providerId: connection.providerId, label });
    const summary = await saveConnection({ deps: scoped.deps, input: { ...where, id: input.id,
      expectedRevision: row.revision, provider: connection.providerId, label, payload: { ...connection }, hintToken: connection.token,
      meta: { ...row.meta, accountLabel: null }, ...(requestedDefault === true ? { isDefault: true } : {}) } });
    return { ...await probeSavedConnection({ deps: scoped.deps, summary, connection, workspaceId: input.workspaceId }), ...reportedScope(deps, scoped) };
  }
  await assertBlankPatchChangesNoField({ patch, registry: () => credentialRegistry({ deps, workspaceId: input.workspaceId }) });
  const provider = await preservedProvider({ raw: patch, existing: existing.providerId, registry: () => credentialRegistry({ deps, workspaceId: input.workspaceId }) });
  await assertMoveFreeOnSite({ deps, scoped, existing, workspaceId: input.workspaceId, providerId: provider, label });
  // Omitting payload retains ciphertext/hints without a key; Jini owns both groups' defaults.
  const summary = await saveConnection({ deps: scoped.deps, input: { ...where, id: input.id,
    expectedRevision: row.revision, provider, label,
    meta: { ...row.meta, accountLabel: provider === existing.providerId ? row.meta.accountLabel : null },
    ...(requestedDefault === true ? { isDefault: true } : {}) } });
  return { ...vaultSummary({ summary, hint: bound(scoped.deps).hint }), connection: "saved", ...reportedScope(deps, scoped) };
}

/**
 * Deletes a credential set. No-op (not an error) if no row exists for `(workspaceId, id)` — matches
 * `SourceControlCredentialSetRepoPort.delete`'s own idempotent contract and this feature's `DELETE`
 * route's documented 204-always behavior. If the deleted row was its provider's default,
 * `SourceControlCredentialSetRepoPort.delete` itself promotes the group's next candidate.
 *
 * @complexity O(1) at this layer (the repo's own promotion work is O(n) in the small provider
 *   group).
 */
export async function deleteSourceControlCredential(deps: SourceControlCredentialReadDeps, input: { workspaceId: UUID; id: UUID }): Promise<void> {
  // A canonical key is removed by the store that owns it, under its own grant and deletion rules.
  if ((await deps.repo.canonical?.remove(input))?.owned) return;
  // A project row is removed only when no other site uses it, with its attachments.
  const located = await locateById({ ...deps, repo: deps.repo }, input);
  if (located) await located.scoped.deps.repo.delete({ workspaceId: located.scoped.workspaceId, id: input.id });
}

/** Select from this view's inventory: a visible default wins, else exactly one eligible row.
 * A project-wide default may belong to another site. Never mutate it or guess among nondefaults.
 * `claimed` holds the labels an earlier (site) store already has for this host: those project rows
 * are overridden (as {@link listEffective} hides them), so they are never the fallback. This store's
 * labels are added to it for the next store.
 * @complexity O(visible credentials); the attached read view enforces site eligibility.
 */
async function selectSourceControlCredential({ repo, workspaceId, providerId, claimed }: {
  repo: SourceControlCredentialSetRepoPort; workspaceId: UUID; providerId: SourceControlProviderId; claimed: Set<string>;
}, _options = {}): Promise<SourceControlCredentialSetRecord | null> {
  const all = await repo.listByProvider({ workspaceId, providerId });
  const rows = all.filter(row => !claimed.has(row.label));
  for (const row of all) claimed.add(row.label);
  const selected = rows.find(row => row.isDefault);
  if (selected || rows.length !== 1) return selected ?? null;
  const only = rows[0];
  if (only === undefined) throw new Error("Source control credential inventory has no sole row");
  return only;
}

/** The selected credential's metadata for a host, never decrypted: this site's, else the project's. */
export async function findDefaultSourceControlCredential(deps: SourceControlCredentialReadDeps,
  input: { workspaceId: UUID; providerId: SourceControlProviderId }): Promise<Pick<SourceControlCredentialSetRecord, "id" | "label" | "providerId"> | null> {
  if (deps.repo.canonical?.supports(input)) return deps.repo.canonical.describe(input);
  const claimed = new Set<string>();
  for (const scoped of credentialScopes({ deps, workspaceId: input.workspaceId })) {
    const found = await selectSourceControlCredential({ repo: scoped.deps.repo, workspaceId: scoped.workspaceId, providerId: input.providerId, claimed });
    if (found) return found;
  }
  return null;
}

/** The first store's selected credential for the host: this site's, else the attached project's.
 * @complexity O(attached inventory); opening retains the vault's context and authentication checks. */
async function findDefaultOpened(deps: { repo: SourceControlCredentialSetRepoPort; sealer: SecretSealerPort }, input: { workspaceId: UUID; providerId: SourceControlProviderId }) {
  const claimed = new Set<string>();
  for (const scoped of credentialScopes({ deps, workspaceId: input.workspaceId })) {
    const selected = await selectSourceControlCredential({ repo: scoped.deps.repo, workspaceId: scoped.workspaceId, providerId: input.providerId, claimed });
    if (!selected) continue;
    // The attached-only inventory can select a sole nondefault without changing the project's default.
    // Open by identity so the default-only reader does not reject that valid selection.
    // The expected group makes Jini refuse a stale selection from another group before opening it.
    const resolved = await vault(scoped.deps).get({ ...bound(scoped.deps).scope({ workspaceId: scoped.workspaceId, kind: "source-control" }), id: selected.id }, { provider: input.providerId });
    if (resolved) return resolved;
  }
  return null;
}

/** Resolve exactly one eligible credential through Jini's context-checked open. Genuine decrypt
 * failures stay typed: this runs in the daemon as well as the HTTP process. */
export async function resolveDefaultForSourceControl(
  deps: { repo: SourceControlCredentialSetRepoPort; sealer: SecretSealerPort },
  input: { workspaceId: UUID; providerId: SourceControlProviderId }
): Promise<{ id: UUID; label: string; connection: SourceControlConnectionInput } | null> {
  try {
    if (deps.repo.canonical?.supports(input)) return await deps.repo.canonical.resolve(input);
    // This site's default first (a site with any row for the host has one), else the project's.
    const resolved = await findDefaultOpened(deps, input);
    if (!resolved) return null;
    if (!resolved.payload) throw new SourceControlCredentialSecretStoreUnconfiguredError(CREDENTIAL_MESSAGES.storage);
    // Reading a saved connection never requires its plugin or reinterprets its paired fields.
    const connection = { ...resolved.payload, providerId: resolved.summary.provider,
      token: normalizeStoredToken({ value: resolved.payload.token }) } as SourceControlConnectionInput;
    return { id: resolved.summary.id, label: resolved.summary.label, connection };
  } catch { throw new SourceControlCredentialSecretStoreUnconfiguredError(CREDENTIAL_MESSAGES.storage); }
}
