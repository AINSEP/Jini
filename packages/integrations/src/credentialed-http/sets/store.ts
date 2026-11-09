import type { CredentialSetConnectionInput, CredentialSetKeyringPort, CredentialSetRecord, CredentialSetRepoPort, CredentialSetScope, CredentialSetSummary } from "@jini-ai/core/contracts/credentials";
import type { SecretSealerPort } from "@jini-ai/core/contracts/vault";
import type { Clock as ClockPort, UUID } from "@jini-ai/core/primitives";
import type { CredentialSetScoped, CredentialSetStoreHost } from "./host.js";
import { credentialSetVaultRecord, credentialSetVaultScope } from "./vault-repo.js";

/**
 * @file Credential-set validation and CRUD over a host-supplied vault. Public summaries contain
 * saved origins, usernames and safe hints only. Tokens live in sealed JSON; boot/recovery owns legacy
 * decoding. Label selection and origin checks never open unrelated credentials. Every product value
 * (owner, metadata policy, categories, scope policy, token policy, wording) arrives as the required
 * `host` input (`./host.ts`); there is no default for any of them.
 * Provenance: moved unchanged (EXTRACT-S8 C1 move) from the first host's credential-set seam file
 * `sets/store.ts` at its commit 43a0e5d4; earlier history lives in that host's repository.
 */

const MAX_LABEL_LENGTH = 200;

/** Shorthand for the required host input every operation below receives. */
type Host<C extends string> = CredentialSetStoreHost<C>;

export class CustomCredentialValidationError extends Error {}

/** A `(workspaceId, label)` collision — the route maps this to `409 DUPLICATE_LABEL`. */
export class CustomCredentialDuplicateLabelError extends Error {}

/** A share copied an older revision; the concurrently changed site row remains intact. */
export class CustomCredentialConcurrentModificationError extends Error {}

/** Thrown when `sealer.seal()`/`keyring.activeKey()` fails while writing a connection — the
 *  realistic cause is a missing store key (a host environment setting), same fail-closed
 *  contract every sibling credential table's store documents. */
export class CustomCredentialSecretStoreUnconfiguredError extends Error {}

export class CustomCredentialNotFoundError extends Error {}

/** Safe hints are stored with the envelope; no per-row decrypt is needed for readback. `scope` is
 *  reported only where a project store is attached, so a site-only server's summaries are unchanged. */
async function toSummary<C extends string>(record: CredentialSetRecord<C>, optional: { scope?: CredentialSetScope } = {}): Promise<CredentialSetSummary<C>> {
  const row = record.vaultRecord;
  return { credentialType: "custom", worksFor: [...(record.worksFor ?? [])], id: record.id, label: record.label, category: record.category, baseUrl: record.baseUrl,
    additionalHosts: record.additionalHosts, ...(record.username !== undefined ? { username: record.username } : {}),
    configured: true, tokenHint: row?.tokenLength === null || row?.tokenLength === undefined ? null :
      { length: row.tokenLength, last4: row.tokenLength >= 12 ? row.last4 : null },
    ...(optional.scope ? { scope: optional.scope } : {}),
    createdAt: record.createdAt, updatedAt: record.updatedAt };
}

/** A row and the store holding it (`vendor-credentials/project-scope.ts`: this site's own vault first,
 *  then the project half `types.ts`'s `repo.project` attaches), with the deps that open it. */
interface Located<D, C extends string = string> { readonly scoped: CredentialSetScoped<D>; readonly record: CredentialSetRecord<C> }

/** The summary's `scope`, only when a project store is attached. */
const reportedScope = <C extends string>(deps: CredentialSetInventoryDeps<C>, scoped: CredentialSetScoped<unknown>): { scope?: CredentialSetScope } =>
  deps.repo.project ? { scope: scoped.scope } : {};

/** The row with this id, from the first store holding it (ids are unique across both). @complexity O(scopes). */
async function locateById<C extends string, D extends CredentialSetReadDeps<C>>(host: Host<C>, deps: D, input: { workspaceId: UUID; id: UUID }): Promise<Located<D, C> | null> {
  for (const scoped of host.scopes(deps, input.workspaceId)) {
    const record = await scoped.deps.repo.findById({ workspaceId: scoped.workspaceId, id: input.id });
    if (record) return { scoped, record };
  }
  return null;
}

/**
 * Every row this site uses, in label order: its own rows, then project rows whose label no site row
 * already claims (a site row of the same label is the override).
 * @complexity O(n log n) in the two stores' (small) credential counts; no row is opened.
 */
async function listEffective<C extends string, D extends CredentialSetInventoryDeps<C>>(host: Host<C>, deps: D, workspaceId: UUID): Promise<Located<D, C>[]> {
  const found: Located<D, C>[] = [];
  const labels = new Set<string>();
  for (const scoped of host.scopes(deps, workspaceId)) {
    const records = await scoped.deps.repo.listByWorkspace({ workspaceId: scoped.workspaceId });
    for (const record of records.filter((row) => !labels.has(row.label))) found.push({ scoped, record });
    for (const record of records) labels.add(record.label);
  }
  return found.sort((a, b) => host.vault.compareLabels(a.record, b.record));
}

/** Presence inventory never needs a sealer or write ports. */
export interface CredentialSetInventoryDeps<C extends string = string> {
  repo: Pick<CredentialSetRepoPort<C>, "listByWorkspace" | "project">;
}

export interface CredentialSetReadDeps<C extends string = string> {
  repo: CredentialSetRepoPort<C>;
  sealer?: SecretSealerPort;
}

/** Every exported operation's required input: the host policy, the store deps, and the request. */
export interface CredentialSetCall<C extends string, D, I> { host: Host<C>; deps: D; input: I }

/**
 * The read model for ONE credential set. Pure DB read — no sealer, no keyring, cannot fail on a
 * misconfigured site key. Returns `null` if no row exists for `(workspaceId, id)` (not an
 * error — the caller decides whether that is a 404).
 *
 * @agent-note Metadata only: never opens an envelope.
 * @complexity O(1) — one `findById` lookup.
 */
export async function describeCredentialSet<C extends string>({ host, deps, input }: CredentialSetCall<C, CredentialSetReadDeps<C>, { workspaceId: UUID; id: UUID }>, _optional = {}): Promise<CredentialSetSummary<C> | null> {
  const located = await locateById(host, deps, input);
  return located ? toSummary(located.record, reportedScope(deps, located.scoped)) : null;
}

/**
 * The non-decrypting sibling of {@link resolveCredentialSetByLabel}: finds a credential by its
 * exact label and returns its read model — `baseUrl`/`additionalHosts` included, since both are
 * plaintext metadata — WITHOUT ever touching `sealer`/`keyring`. Exists so a caller that only needs
 * to validate a request's target origin or render a confirmation dialog never has to decrypt just to
 * read two plaintext fields — the same "never touches the sealer" contract
 * {@link describeCredentialSet} already documents, applied to a label lookup instead of an id lookup.
 *
 * @agent-note Metadata only: never opens an envelope.
 * @complexity O(n) in the workspace's own (small) credential-set count, or one indexed read where
 *   the repo supplies `findByLabel`.
 */
export async function describeCredentialSetByLabel<C extends string>({ host, deps, input }: CredentialSetCall<C, CredentialSetReadDeps<C>, { workspaceId: UUID; label: string }>, _optional = {}): Promise<CredentialSetSummary<C> | null> {
  const located = await locateByLabel({ host, deps, input });
  return located ? toSummary(located.record, reportedScope(deps, located.scoped)) : null;
}

/**
 * The effective credential sets this workspace uses. The admin inventory has its own unfiltered
 * read model below. Same "never decrypts" contract as {@link describeCredentialSet}.
 *
 * @complexity O(n) in the workspace's own (small) credential-set count. One repo read, one array
 *   map, no per-row I/O.
 */
export async function listCredentialSets<C extends string>({ host, deps, input }: CredentialSetCall<C, CredentialSetInventoryDeps<C>, { workspaceId: UUID }>, _optional = {}): Promise<CredentialSetSummary<C>[]> {
  const located = await listEffective(host, deps, input.workspaceId);
  return Promise.all(located.map(({ scoped, record }) => toSummary(record, reportedScope(deps, scoped))));
}

/** Admin inventory includes unattached project keys and same-label site overrides. The existing
 * guarded metadata repo exposes those rows without changing runtime credential resolution.
 * @param required Host policy, metadata repositories and the current site's workspace id.
 * @returns Safe summaries only; never opens an envelope.
 * @throws Repository or metadata-validation errors propagate to the admin adapter.
 * @complexity O(n log n) time and O(n) space for n saved keys; at most two store reads, no per-key I/O.
 * @example await listCredentialSetInventory({ host, deps, workspaceId });
 */
export async function listCredentialSetInventory<C extends string>({ host, deps, workspaceId }: {
  host: Host<C>; deps: CredentialSetInventoryDeps<C>; workspaceId: UUID;
}, _optional = {}): Promise<CredentialSetSummary<C>[]> {
  const stores = await Promise.all(host.scopes(deps, workspaceId).map(async scoped => {
    const source = scoped.scope === "project" ? deps.repo.project?.inventoryRepo ?? scoped.deps.repo : scoped.deps.repo;
    const records = await source.listByWorkspace({ workspaceId: scoped.workspaceId });
    return Promise.all(records.map(record => toSummary(record, reportedScope(deps, scoped))));
  }));
  return stores.flat().sort((a, b) => a.label.localeCompare(b.label));
}

export interface CredentialSetWriteDeps<C extends string = string> extends CredentialSetReadDeps<C> {
  /** @agent-note Trusted owner session after human submission; never populated from tool, model or
   *  request input. */
  allowSharedKeyReplacement?: boolean;
  sealer: SecretSealerPort;
  keyring: CredentialSetKeyringPort;
  clock: ClockPort;
  idGen: { newId(): string };
}

/** Narrows and validates a caller-supplied `label`. Never throws a raw `TypeError` — every
 *  rejection is a {@link CustomCredentialValidationError} the route layer can map to its own `400`. */
function validateLabel(host: Host<string>, raw: unknown): string {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new CustomCredentialValidationError("label must be a non-empty string");
  }
  if (raw.length > MAX_LABEL_LENGTH) {
    throw new CustomCredentialValidationError(`label must be ${MAX_LABEL_LENGTH} characters or fewer`);
  }
  assertPlainField(host, { value: raw, field: "label" });
  return raw;
}

/** Narrows and validates a caller-supplied `category` against the host's own category list (stored
 *  as plaintext metadata so it is readable/filterable without ever decrypting a row). */
function validateCategory<C extends string>(host: Host<C>, raw: unknown): C {
  if (typeof raw === "string") assertPlainField(host, { value: raw, field: "category" });
  if (typeof raw !== "string" || !host.categories.includes(raw as C)) {
    throw new CustomCredentialValidationError(`category must be one of: ${host.categories.join(", ")}`);
  }
  return raw as C;
}

/** Narrows and validates a caller-supplied `baseUrl` — must parse as an absolute `http`/`https` URL
 *  (`new URL()` accepts far more schemes than this form should — `javascript:`, `file:`, a bare
 *  `mailto:` — so the scheme is checked explicitly rather than trusting "did not throw"). */
function validateBaseUrl(host: Host<string>, raw: unknown): string {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new CustomCredentialValidationError("baseUrl must be a non-empty string");
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new CustomCredentialValidationError("baseUrl must be a valid absolute URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new CustomCredentialValidationError("baseUrl must use http or https");
  }
  assertPlainField(host, { value: raw, field: "baseUrl" });
  return raw;
}

/** One `additionalHosts` entry's own validation — split out of {@link validateAdditionalHosts} so
 *  that function's `.map()` body stays a single call, and so each rejection names its own index. */
function validateAdditionalHostEntry(host: Host<string>, raw: unknown, index: number): string {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new CustomCredentialValidationError(`additionalHosts[${index}] must be a non-empty string`);
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new CustomCredentialValidationError(`additionalHosts[${index}] must be a valid absolute URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new CustomCredentialValidationError(`additionalHosts[${index}] must use http or https`);
  }
  assertPlainField(host, { value: raw, field: "additionalHosts" });
  return parsed.origin;
}

/**
 * Validates and normalizes the optional `additionalHosts` field (owner-driven multi-host support).
 * `undefined` (the field was omitted) degrades to no extra hosts, matching every other optional
 * field's "omitted is not an error" contract on this store. Each entry is normalized to its own
 * ORIGIN (scheme+host+port, no path) and the result is deduped — this is what lets a credentialed
 * request compare a resolved URL origin against this list with plain `===`/`.includes()`, never
 * re-parsing at request time.
 *
 * @throws {CustomCredentialValidationError} `raw` is not an array, or any entry fails
 *   {@link validateAdditionalHostEntry}.
 * @complexity O(n) in the number of supplied hosts.
 */
function validateAdditionalHosts(host: Host<string>, raw: unknown): readonly string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new CustomCredentialValidationError("additionalHosts must be an array of absolute http/https URLs");
  }
  return [...new Set(raw.map((entry, index) => validateAdditionalHostEntry(host, entry, index)))];
}

function optionalString(raw: unknown, field: string): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new CustomCredentialValidationError(`'${field}' must be a non-empty string when provided`);
  }
  return raw;
}

/**
 * Validates {@link UpdateCredentialSetInput.username} — a THREE-way field, unlike
 * {@link optionalString}'s two-way "omitted or a non-empty string": this function is only ever
 * called once the caller has already checked `raw !== undefined` (omitted = leave the column alone,
 * a case this function never sees), so the two values left to distinguish are "clear it" and "set
 * it". `null` is the deliberate clear sentinel — chosen specifically because a blank string could not
 * serve double duty as both "leave alone" (the `optionalString` convention every other field on this
 * store already trained a caller to expect from a falsy value) and "clear" without one of those two
 * meanings silently winning over the other; `updateCredentialSet`'s own doc has the full
 * precedence writeup. A blank string is therefore still rejected here, same as everywhere else on
 * this store — it is neither of this field's two valid non-omitted values, not a quiet no-op.
 *
 * @throws {CustomCredentialValidationError} `raw` is present, not `null`, and not a non-empty string.
 * @complexity O(1).
 */
function validateUsernamePatch(host: Host<string>, raw: unknown): string | undefined {
  if (raw === null) return undefined;
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new CustomCredentialValidationError("'username' must be a non-empty string, or null to clear it");
  }
  assertPlainField(host, { value: raw, field: "username" });
  return raw;
}

/**
 * Validates a caller-supplied `connection` — just `{token, username?}`, no provider dispatch (see
 * this file's own header). Never throws a raw shape error — every rejection is a
 * {@link CustomCredentialValidationError}.
 *
 * @complexity O(1) — fixed-shape field reads, no iteration.
 */
function isEmptyTokenPatch(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const token = (raw as Record<string, unknown>).token;
  return token === '' || token === undefined;
}
function normalizeStoredToken(host: Host<string>, { value }: { value: unknown }): string {
  try { return host.token.normalize({ value }); }
  catch (err) { if (host.token.isInputError(err)) { throw new CustomCredentialValidationError(err.message); } throw err; }
}
function assertPlainField(host: Host<string>, required: { value: string; field: string }): void {
  try { host.token.assertFreeField(required); }
  catch (err) { if (host.token.isInputError(err)) { throw new CustomCredentialValidationError(err.message); } throw err; }
}

function validateConnection(host: Host<string>, raw: unknown): CredentialSetConnectionInput {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new CustomCredentialValidationError("connection must be an object");
  }
  const value = raw as Record<string, unknown>;
  const token = normalizeStoredToken(host, { value: value.token });
  const username = optionalString(value.username, "username");
  if (username !== undefined) assertPlainField(host, { value: username, field: "username" });
  return { token, ...(username !== undefined ? { username } : {}) };
}

export interface CreateCredentialSetInput {
  workspaceId: UUID;
  label: unknown;
  category: unknown;
  baseUrl: unknown;
  connection: unknown;
  /** Omitted = no extra hosts beyond `baseUrl`. See `validateAdditionalHosts`'s own doc. */
  additionalHosts?: unknown;
  worksFor?: unknown;
  /** `"site"` = a site-owned key. Omitted (or `"project"`) = the project store when one is
   *  attached, visible to attached sites only; this site's vault otherwise. */
  scope?: unknown;
}

/** Where a new row is written (host scope policy): the project store unless "site".
 * @throws {CustomCredentialValidationError} `scope` is neither omitted, `"site"` nor `"project"`. */
const createTarget = <C extends string, D extends CredentialSetReadDeps<C>>(host: Host<C>, deps: D, input: { workspaceId: UUID; scope?: unknown }): CredentialSetScoped<D> =>
  host.createTarget(deps, input, message => new CustomCredentialValidationError(message));

const duplicateLabel = (host: Host<string>, label: string) => new CustomCredentialDuplicateLabelError(host.messages.duplicateLabel({ label }));

/**
 * A project row whose label this site already uses would be hidden here by the site row (site rows
 * override), so the save would look lost: refused as the same duplicate as within one store.
 */
async function assertLabelFreeOnSite<C extends string>(host: Host<C>, deps: CredentialSetReadDeps<C>, input: { target: CredentialSetScoped<unknown>; workspaceId: UUID; label: string }): Promise<void> {
  if (input.target.scope !== "project") return;
  const site = await deps.repo.listByWorkspace({ workspaceId: input.workspaceId });
  if (site.some((row) => row.label === input.label)) throw duplicateLabel(host, input.label);
}

/**
 * Translates a failed insert/update of row `id` into the domain duplicate-label error, else rethrows.
 * @throws {CustomCredentialDuplicateLabelError} The store refused `label` as taken.
 * @throws The original error otherwise.
 */
async function throwSaveError<C extends string>(host: Host<C>, deps: CredentialSetReadDeps<C>, input: { err: unknown; target: CredentialSetScoped<unknown>; id: UUID; label: string }): Promise<never> {
  const { err, target, id, label } = input;
  if (host.isCreateConflict(err)) throw new CustomCredentialDuplicateLabelError(err.message);
  // Unattached project rows are hidden from the normal reader. Check metadata only to distinguish
  // a duplicate label from a CAS conflict; never attach or open the existing credential.
  const inventory = deps.repo.project;
  const hiddenDuplicate = target.scope === "project" && host.vault.vaultErrors.codeOf(err) === "conflict"
    && (await inventory!.repo.listByWorkspace({ workspaceId: target.workspaceId })).some(row => row.label === label && row.id !== id);
  // The host's storage kernel recognizes the label's UNIQUE (workspace_id, …, label) index on any database.
  if (host.isUniqueViolation(err) || hiddenDuplicate) throw target.scope === "project" ? new CustomCredentialDuplicateLabelError(host.messages.projectDuplicateLabel({ label })) : duplicateLabel(host, label);
  throw err;
}

/**
 * Validates, seals, and inserts a new credential set. `id` is minted here (`deps.idGen`), not
 * caller-supplied.
 *
 * @agent-note Validation order is label, category, baseUrl, additionalHosts, connection, then scope;
 *   one seal (via `host.openVault(...).prepare`) and one insert follow. Ownership comes from the
 *   trusted host policy, never from input.
 * @throws {CustomCredentialValidationError} `label`/`category`/`baseUrl`/`connection` fails shape
 *   validation.
 * @throws {CustomCredentialDuplicateLabelError} `(workspaceId, label)` already exists.
 * @throws {CustomCredentialSecretStoreUnconfiguredError} The store key is unavailable.
 * @complexity O(1) plus one keyring derivation, one seal, and one insert (which may itself throw on
 *   the UNIQUE index, translated here rather than propagated raw).
 */
export async function createCredentialSet<C extends string>({ host, deps, input }: CredentialSetCall<C, CredentialSetWriteDeps<C>, CreateCredentialSetInput>, _optional = {}): Promise<CredentialSetSummary<C>> {
  const label = validateLabel(host, input.label);
  const category = validateCategory(host, input.category);
  const baseUrl = validateBaseUrl(host, input.baseUrl);
  const additionalHosts = validateAdditionalHosts(host, input.additionalHosts);
  const connection = validateConnection(host, input.connection);
  const target = createTarget(host, deps, input);
  await assertLabelFreeOnSite(host, deps, { target, workspaceId: input.workspaceId, label });
  const id = deps.idGen.newId();
  const prepared = await host.openVault({ deps: target.deps, kind: "vendor" }).prepare({ ...credentialSetVaultScope({ workspaceId: target.workspaceId, id, ownerKey: host.vault.ownerKey }),
    id, expectedRevision: null, provider: null, label,
    meta: { credentialType: "custom", worksFor: validatedWorksFor(host, { value: input.worksFor === undefined ? [] : input.worksFor }), category, baseUrl, additionalHosts: [...additionalHosts], username: connection.username ?? null },
    payload: { token: connection.token }, hintToken: connection.token });
  const record = credentialSetVaultRecord<C>({ row: prepared, expectedRevision: null, policy: host.vault });
  try { await target.deps.repo.insert(record); }
  catch (err) { return throwSaveError(host, deps, { err, target, id, label }); }
  return toSummary(record, reportedScope(deps, target));
}

export interface UpdateCredentialSetInput {
  workspaceId: UUID;
  id: UUID;
  /** Omitted = leave the label unchanged. */
  label?: unknown;
  /** Omitted = leave the category unchanged. */
  category?: unknown;
  /** Omitted = leave the base URL unchanged. */
  baseUrl?: unknown;
  /** Omitted = leave the additional hosts unchanged. Supplying a value REPLACES the whole list
   *  (never merges). */
  additionalHosts?: unknown;
  worksFor?: unknown;
  /** Omitted = leave the stored connection untouched — same "omitting `connection` keeps the
   *  secret" contract every sibling credential route documents. */
  connection?: unknown;
  /**
   * Independent, top-level control over the plaintext `username` metadata, so an operator can fix a
   * saved credential's username WITHOUT retyping the token.
   *
   * Three states, validated by {@link validateUsernamePatch}: omitted (`undefined`) leaves the column
   * exactly as `connection` (if supplied) would otherwise have set it; `null` explicitly clears it;
   * any other value must be a non-empty string. See `updateCredentialSet`'s own doc for the
   * precedence rule when this field AND `connection` are both supplied in the same call.
   */
  username?: unknown;
}

/** Validate metadata in its original order before inspecting a replacement connection. */
function updatedMetadata<C extends string>({ host, input, existing }: {
  host: Host<C>; input: UpdateCredentialSetInput; existing: CredentialSetRecord<C>;
}, _options = {}) {
  const label = input.label !== undefined ? validateLabel(host, input.label) : existing.label;
  const category = input.category !== undefined ? validateCategory(host, input.category) : existing.category;
  const baseUrl = input.baseUrl !== undefined ? validateBaseUrl(host, input.baseUrl) : existing.baseUrl;
  const additionalHosts = input.additionalHosts !== undefined ? validateAdditionalHosts(host, input.additionalHosts) : existing.additionalHosts;
  return { label, category, baseUrl, additionalHosts };
}

/** Blank connection patches preserve both the envelope and its saved username. */
function updatedConnection<C extends string>({ host, input, existing }: {
  host: Host<C>; input: UpdateCredentialSetInput; existing: CredentialSetRecord<C>;
}, _options = {}) {
  const connection = input.connection !== undefined && !isEmptyTokenPatch(input.connection) ? validateConnection(host, input.connection) : undefined;
  let username = connection ? connection.username : existing.username;
  if (input.username !== undefined) username = validateUsernamePatch(host, input.username);
  return { connection, username };
}

/** Only the trusted owner card may replace a granted shared entry. Local rows use their own repo.
 * The replacement adapter rechecks the grant at commit, so revocation while a card is open wins.
 * @agent-note `allowSharedKeyReplacement` is trusted host state, never model input.
 * @complexity O(1); no inventory reads or key material are exposed.
 */
function sharedReplacementScope<C extends string>({ host, deps, scoped }: { host: Host<C>; deps: CredentialSetWriteDeps<C>; scoped: CredentialSetScoped<CredentialSetWriteDeps<C>> }): CredentialSetScoped<CredentialSetWriteDeps<C>> {
  const project = deps.repo.project;
  if (scoped.scope !== "project" || !project?.createRepo) return scoped;
  if (!deps.allowSharedKeyReplacement || !project.replaceRepo) throw new CustomCredentialValidationError(host.messages.sharedReplacementReadOnly);
  return { ...scoped, deps: { ...scoped.deps, repo: project.replaceRepo } };
}

/** Partial update: blank/omitted connection preserves the envelope, replacing a connection resets
 * its username, and a supplied top-level username wins (null clears). Username is metadata only;
 * removing the old ciphertext fallback makes clear impossible to resurrect, without opening it.
 * @agent-note The row keeps its stored kind (legacy `custom` stays `custom`) so its AAD still
 *   authenticates; the write is CAS on the revision read here, through the store that holds the row.
 * @complexity Constant queries/seals plus metadata size; CAS rejects a concurrent replacement.
 */
export async function updateCredentialSet<C extends string>({ host, deps, input }: CredentialSetCall<C, CredentialSetWriteDeps<C>, UpdateCredentialSetInput>, _optional = {}): Promise<CredentialSetSummary<C>> {
  // Changed where it lives: this site's own row, else the project's attached row.
  const located = await locateById(host, deps, input);
  if (!located) throw new CustomCredentialNotFoundError(host.messages.notFound({ id: input.id }));
  const { record: existing } = located;
  const scoped = sharedReplacementScope({ host, deps, scoped: located.scoped });
  const { label, category, baseUrl, additionalHosts } = updatedMetadata({ host, input, existing });
  const { connection, username } = updatedConnection({ host, input, existing });
  // A rename gets the same site-label check as a create (`assertLabelFreeOnSite`).
  if (label !== existing.label) await assertLabelFreeOnSite(host, deps, { target: scoped, workspaceId: input.workspaceId, label });
  const expectedRevision = existing.vaultRecord!.revision;
  const kind = existing.vaultRecord!.kind === "custom" ? "custom" : "vendor";
  const prepared = await host.openVault({ deps: scoped.deps, kind }).prepare({ ...credentialSetVaultScope({ workspaceId: scoped.workspaceId, kind, ownerKey: host.vault.ownerKey }), id: input.id,
    expectedRevision, provider: null, label,
    meta: { ...existing.vaultRecord!.meta, worksFor: input.worksFor === undefined ? [...(existing.worksFor ?? [])] : validatedWorksFor(host, { value: input.worksFor }), category, baseUrl, additionalHosts: [...additionalHosts], username: username ?? null },
    ...(connection ? { payload: { token: connection.token }, hintToken: connection.token } : {}) });
  const record = credentialSetVaultRecord<C>({ row: prepared, expectedRevision, policy: host.vault });
  try { await scoped.deps.repo.update(record); }
  catch (err) { return throwSaveError(host, deps, { err, target: scoped, id: input.id, label }); }
  return toSummary(record, reportedScope(deps, scoped));
}

/**
 * Deletes a credential set. No-op (not an error) if no row exists for `(workspaceId, id)` — matches
 * `CredentialSetRepoPort.delete`'s own idempotent contract.
 *
 * @complexity O(1).
 */
export async function deleteCredentialSet<C extends string>({ host, deps, input }: CredentialSetCall<C, CredentialSetReadDeps<C>, { workspaceId: UUID; id: UUID }>, _optional = {}): Promise<void> {
  // A project row is removed only when no other site uses it, with its attachments.
  const located = await locateById(host, { ...deps, repo: deps.repo }, input);
  if (located?.scoped.scope === "project" && deps.repo.project?.createRepo) throw new CustomCredentialValidationError(host.messages.sharedDeleteReadOnly);
  if (located) await located.scoped.deps.repo.delete({ workspaceId: located.scoped.workspaceId, id: input.id });
}

export interface CredentialSetResolveDeps<C extends string = string> {
  repo: CredentialSetRepoPort<C>;
  sealer: SecretSealerPort;
}

/** Select by saved label without opening, then open only that row under its expected ownership.
 * Saved metadata is the authoritative source of allowed origins and username, including clears.
 * @agent-note Exactly one envelope is opened: the selected, authorized row, with the store that
 *   holds it. Origins and username come from the SAME read as the token.
 * @throws CustomCredentialSecretStoreUnconfiguredError on crypto failure.
 * @complexity O(n) metadata selection, n workspace rows, plus one selected envelope open.
 */
export async function resolveCredentialSetByLabel<C extends string>(
  { host, deps, input }: CredentialSetCall<C, CredentialSetResolveDeps<C>, { workspaceId: UUID; label: string }>, _optional = {}
): Promise<{ id: UUID; category: C; baseUrl: string; additionalHosts: readonly string[]; connection: CredentialSetConnectionInput } | null> {
  const located = await locateByLabel({ host, deps, input });
  if (!located) return null;
  const opened = await openLocated(host, located as Located<CredentialSetResolveDeps<C>, C>);
  if (!opened) return null;
  // Use metadata from the same read as the payload, so a concurrent origin/username update cannot
  // pair a new token with the old allowlist. Never fall back to an embedded legacy username.
  const { token, meta: current } = opened;
  return { id: located.record.id, category: current.category as C, baseUrl: current.baseUrl as string,
    additionalHosts: current.additionalHosts as string[], connection: { token,
      ...(typeof current.username === "string" ? { username: current.username } : {}) } };
}

/** Production project readers resolve one granted label through an indexed join, never inventory.
 * Compatibility fixture ports without that query retain their existing metadata scan.
 * @complexity O(1) selected row reads on the composed owner store.
 */
async function locateByLabel<C extends string>({ host, deps, input }: { host: Host<C>; deps: CredentialSetReadDeps<C>; input: { workspaceId: UUID; label: string } }): Promise<Located<CredentialSetReadDeps<C>, C> | undefined> {
  for (const scoped of host.scopes(deps, input.workspaceId)) {
    const repo = scoped.deps.repo;
    const record = repo.findByLabel ? await repo.findByLabel({ workspaceId: scoped.workspaceId, label: input.label })
      : (await repo.listByWorkspace({ workspaceId: scoped.workspaceId })).find(row => row.label === input.label);
    if (record) return { scoped, record };
  }
  return undefined;
}

/** Opens one located row with the store that sealed it: its token and the metadata of that same read.
 * @throws CustomCredentialSecretStoreUnconfiguredError on crypto failure or a payload without a token. */
async function openLocated<C extends string>(host: Host<C>, { scoped, record }: Located<CredentialSetResolveDeps<C>, C>): Promise<{ token: string; meta: Record<string, unknown> } | null> {
  const kind = record.vaultRecord!.kind === "custom" ? "custom" : "vendor";
  const resolved = await host.openVault({ deps: scoped.deps, kind }).get({ ...credentialSetVaultScope({ ...record, kind, ownerKey: host.vault.ownerKey }), id: record.id });
  if (!resolved) return null;
  if (typeof resolved.payload?.token !== "string") throw new CustomCredentialSecretStoreUnconfiguredError(host.messages.storage);
  return { token: resolved.payload.token, meta: resolved.summary.meta };
}

/** Keep the store's validation error contract while reusing the host's canonical ID parser. */
function validatedWorksFor(host: Host<string>, { value }: { value: unknown }, _options = {}): string[] {
  try { const ids = host.normalizeWorksFor({ value }); for (const id of ids) { assertPlainField(host, { value: id, field: "worksFor" }); } return ids; }
  catch (error) { if (host.vault.vaultErrors.codeOf(error) !== undefined) { throw new CustomCredentialValidationError(host.messages.worksForInvalid); } throw error; }
}
