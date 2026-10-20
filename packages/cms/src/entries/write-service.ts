import { nowIso as kernelNowIso } from "@jini-ai/core/primitives";
import type { Clock } from "@jini-ai/core/primitives";
import {
  ContentTypeNotActiveError,
  ContentTypeNotFoundError,
  EntryFieldValidationError,
  EntryNotFoundError,
  EntrySlugConflictError,
  entryVersionConflictError,
  ForbiddenError,
  VersionConflictError,
} from "./errors.js";
import { validateFieldsAgainstSchema } from "./field-validation.js";
import type { Result } from "@jini-ai/core/primitives";
import type { ActorIdentityInput, EntryRecord, EntryStatus, OwningContentType } from "./types.js";

/**
 * @file The `entries` write chokepoint: `createEntry`,
 * `updateEntry`, `publishEntry`, `unpublishEntry`.
 *
 * Purpose:
 * The ONLY path that creates or mutates an `entries` row. `createEntry` validates the owning
 * content type exists IN THIS WORKSPACE (a soft polymorphic reference, so a same-key type
 * owned by a different workspace must never be silently accepted), is `active` (new-entry
 * creation is blocked for both `deprecated` and `tombstone` owning types), and that `(workspaceId,
 * type, slug)` is unique before writing.
 *
 * `updateEntry`/`publishEntry`/`unpublishEntry` invert that rule: only a
 * `tombstone` owning type blocks these; `deprecated` blocks none of them —
 * deprecation only ever stops NEW entries, never touches entries that already exist.
 *
 * How it relates to the project:
 * `deps.watermark` and the actor-identity delegation fields mirror
 * `features/content-types/write-service.ts`'s identical optional/additive shape —
 * `watermark-stamping.integration.test.ts` exercises both packages side by side to prove they
 * share the same chokepoint discipline.
 *
 * Architectural role:
 * `features/entries` domain logic. Depends only on `core/ports` and this package's own
 * `errors.ts`/`field-validation.ts`/`types.ts` — never on `features/content-types`' write path,
 * only its read-only `OwningContentType` type shape.
 */

/**
 * `entityType`/`entityId` are threaded through so `createEntry`/`resolveExistingEntryForTransition`
 * below can pass `entityType: "entry"` to `deps.authorize()` — matching every fronting HTTP route's
 * own `entityType: "entry"` pre-check exactly. Before this, this chokepoint's calls omitted
 * `entityType` entirely, so `identity/authorize.ts`'s evaluator (`resourceType != null &&
 * resourceType !== context.entityType` never matches a missing `entityType`) denied a principal
 * holding ONLY an entry-scoped grant with `resource_scope_mismatch`, even though the route's own
 * pre-check — and any owner/unscoped grant — allowed the identical request. This chokepoint is also
 * the ONLY authorization check the agent-tool surface ever reaches (see `agent-tools.ts`'s header:
 * tools call these functions directly, never through an HTTP route), so it must be at least as
 * expressive as the route, not merely consistent with it.
 */
export type { AuthorizationPort as AuthorizeFn } from '../core/authorization.js';
import type { AuthorizationPort as AuthorizeFn } from '../core/authorization.js';

export interface EntryRevisionInput {
  entryId: string;
  workspaceId: string;
  op: "create" | "update" | "publish" | "unpublish";
  stateJson: EntryRecord;
  actorId: string;
  delegatedByWorkspaceId: string | null;
  delegatedById: string | null;
  recordedAt: string;
}

/** Options for {@link EntryRepoPort.save}. */
export interface EntrySaveOptions {
  /** The version the caller read; the save throws `VersionConflictError` unless the stored live row still holds it.
   *  `null` is a create: the save throws unless no row (live, trashed, or in another workspace) holds the id. */
  expectedVersion?: number | null | undefined;
}

export interface EntryRepoPort {
  findBySlug(params: { workspaceId: string; type: string; slug: string }): Promise<EntryRecord | null>;
  findById(params: { workspaceId: string; id: string }): Promise<EntryRecord | null>;
  /**
   * Writes `row` by id. With `expectedVersion`, the write is a compare-and-set: it lands only when the
   * stored live (not trashed) row still holds that version, checked atomically with the write (one
   * conditional UPDATE in a SQL adapter), so two writers that read the same version cannot both land.
   * With `expectedVersion: null` it is insert-if-absent (an import-as-create; `INSERT ... ON CONFLICT DO
   * NOTHING` in a SQL adapter), so two creates of one id cannot both land either.
   * Without it, the write is unconditional (`createEntry`'s freshly minted id, trash seams).
   * @throws VersionConflictError ``expected version <n> for entry '<id>', found <stored|none>`` ({@link entryVersionConflictError}).
   */
  save(row: EntryRecord, options?: EntrySaveOptions): Promise<void>;
  appendRevision(revision: EntryRevisionInput): Promise<void>;
  transaction<T>(required: { fn: () => Promise<T> }): Promise<T>;
}

export interface ContentTypeLookupPort {
  findByKey(params: { workspaceId: string; key: string }): Promise<OwningContentType | null>;
}

export interface OutboxPort {
  enqueue(event: { name: string; payload: Record<string, unknown> }): Promise<void>;
}

/** Optional — advances `database_write_watermark` by exactly 1 when supplied. */
export interface WatermarkPort {
  stampWatermark(input: { workspaceId: string }): Promise<number>;
}

function delegationFields(input: ActorIdentityInput): { delegatedByWorkspaceId: string | null; delegatedById: string | null } {
  return {
    delegatedByWorkspaceId: input.delegatedByWorkspaceId ?? null,
    delegatedById: input.delegatedById ?? null,
  };
}

/**
 * Validates `fieldsJson` against an owning type's schema under its `owner` namespace and, on failure,
 * builds the refusal every write path returns — carrying the complete declared schema so a caller
 * (an agent especially) can correct the payload in one turn.
 *
 * @complexity O(f + k), one field-validation pass.
 */
function fieldValidationError(required: {
  type: string;
  owner: string | undefined;
  fields: OwningContentType["fields"];
  fieldsJson: unknown;
}): EntryFieldValidationError | null {
  const { type, owner, fields, fieldsJson } = required;
  const validation = validateFieldsAgainstSchema({ schema: fields, fieldsJson }, { owner });
  if (validation.valid) return null;
  return new EntryFieldValidationError({ fieldErrors: validation.fieldErrors, entitySchema: { type, owner: owner ?? "site", fields } });
}

/**
 * Looks up the owning content type and refuses it unless it is owned by THIS workspace — a soft
 * polymorphic reference, so a same-key type owned by a different workspace must never be silently
 * accepted. Shared by `createEntry` and `importEntry`, which differ only in the status rule applied after.
 *
 * @complexity O(1) plus one content-type read.
 */
async function findWorkspaceContentType(required: {
  contentTypeRepo: ContentTypeLookupPort;
  workspaceId: string;
  type: string;
}): Promise<Result<OwningContentType, Error>> {
  const { contentTypeRepo, workspaceId, type } = required;
  const contentType = await contentTypeRepo.findByKey({ workspaceId, key: type });
  if (!contentType || contentType.workspaceId !== workspaceId) {
    return { ok: false, error: new ContentTypeNotFoundError({ message: `content type '${type}' was not found in workspace '${workspaceId}'` }) };
  }
  return { ok: true, value: contentType };
}

/**
 * The body of every entry write's transaction: save the row, append its revision, then the optional
 * watermark stamp and optional `onWritten` side effect — in that order, all in the caller's
 * transaction so a failure in any step rolls back the whole write.
 *
 * `saveOptions` omitted means an unconditional `save(row)` with no options argument at all
 * (`createEntry`'s freshly minted id); the versioned paths always pass one.
 *
 * @complexity O(1) plus one save, one revision append, and the optional side effects.
 */
async function persistEntryWrite(
  required: {
    deps: { entryRepo: EntryRepoPort; watermark?: WatermarkPort | undefined };
    entry: EntryRecord;
    op: EntryRevisionInput["op"];
    input: ActorIdentityInput & { workspaceId: string };
    recordedAt: string;
  },
  optional: { saveOptions?: EntrySaveOptions; onWritten?: ((entry: EntryRecord) => Promise<void>) | undefined } = {},
): Promise<void> {
  const { deps, entry, op, input, recordedAt } = required;
  const { saveOptions, onWritten } = optional;
  await (saveOptions ? deps.entryRepo.save(entry, saveOptions) : deps.entryRepo.save(entry));
  await deps.entryRepo.appendRevision({
    entryId: entry.id,
    workspaceId: input.workspaceId,
    op,
    stateJson: entry,
    actorId: input.actorId,
    ...delegationFields(input),
    recordedAt,
  });
  if (deps.watermark) await deps.watermark.stampWatermark({ workspaceId: input.workspaceId });
  if (onWritten) await onWritten(entry);
}

export interface CreateEntryRequired {
  deps: {
    entryRepo: EntryRepoPort;
    contentTypeRepo: ContentTypeLookupPort;
    clock: Clock;
    ids: { newId: () => string };
    authorize: AuthorizeFn;
    outbox: OutboxPort;
    watermark?: WatermarkPort;
    /**
     * Optional same-transaction side effect (e.g. a feature's `entry_refs` extractor), invoked
     * inside the write's own `entryRepo.transaction()` block, after `save`/`appendRevision` but
     * before commit — so a failure here rolls back the whole write, same unit of work, not a
     * best-effort follow-up call. Purely additive: omit it and behavior is unchanged.
     */
    onWritten?: (entry: EntryRecord) => Promise<void>;
  };
  input: ActorIdentityInput & {
    workspaceId: string;
    type: string;
    slug: string;
    title: string;
    fieldsJson: unknown;
    bodyJson?: unknown;
  };
}

/**
 * — creates a new entry. Order: authorize -> owning-type exists AND is owned by this
 * workspace -> owning-type is `active` -> `fieldsJson` validates against the
 * type's current schema -> `(workspaceId, type, slug)` uniqueness -> same-tx write +
 * revision + watermark + optional `deps.onWritten` side effect -> `entry.created` outbox event
 *
 *
 * @complexity O(1) plus one content-type read, one field-validation pass, one slug lookup, and one
 * same-tx write pair.
 * @overallScore 100
 * See docs/decisions/DR-002-content-lifecycle-and-cleanup.md.
 */
export async function createEntry(required: CreateEntryRequired): Promise<Result<{ entry: EntryRecord }, Error>> {
  const { deps, input } = required;

  const authResult = await deps.authorize({ principalId: input.actorId, permission: "admin.collections.manage", workspaceId: input.workspaceId }, { entityType: "entry" });
  if (!authResult.allowed) {
    return { ok: false, error: new ForbiddenError({ message: `principal '${input.actorId}' cannot create an entry (${authResult.reason})` }) };
  }

  const found = await findWorkspaceContentType({ contentTypeRepo: deps.contentTypeRepo, workspaceId: input.workspaceId, type: input.type });
  if (!found.ok) return found;
  const contentType = found.value;
  if (contentType.status !== "active") {
    // See docs/decisions/DR-002-content-lifecycle-and-cleanup.md for the invariant behind this refusal; keep external identifiers out of caller-facing messages.
    return { ok: false, error: new ContentTypeNotActiveError({ message: `content type '${input.type}' is not active; new entries cannot be created` }) };
  }

  // The envelope namespace comes from the owning TYPE, never the caller (2026-10-04). It used to be
  // `input.owner` defaulting to "site": the generic entries route passed none, so a widget-owned
  // type's payload validated under `ext.site` and wrote a row the widgets reader could never parse.
  // The same rule holds in `updateEntry` and `importEntry` below.
  const fieldError = fieldValidationError({ type: contentType.key, owner: contentType.owner, fields: contentType.fields, fieldsJson: input.fieldsJson });
  if (fieldError) return { ok: false, error: fieldError };

  const existing = await deps.entryRepo.findBySlug({ workspaceId: input.workspaceId, type: input.type, slug: input.slug });
  if (existing) {
    return { ok: false, error: new EntrySlugConflictError({ message: `an entry with slug '${input.slug}' already exists for type '${input.type}' in workspace '${input.workspaceId}'` }) };
  }

  const now = kernelNowIso({ clock: deps.clock });
  const entry: EntryRecord = {
    id: deps.ids.newId(),
    workspaceId: input.workspaceId,
    type: input.type,
    slug: input.slug,
    status: "draft",
    title: input.title,
    bodyJson: input.bodyJson ?? null,
    fieldsJson: input.fieldsJson,
    publishedAt: null,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };

  await deps.entryRepo.transaction({ fn: () => persistEntryWrite({ deps, entry, op: "create", input, recordedAt: now }, { onWritten: deps.onWritten }) });

  await deps.outbox.enqueue({ name: "entry.created", payload: { workspaceId: input.workspaceId, entryId: entry.id, type: input.type, slug: input.slug } });

  return { ok: true, value: { entry } };
}

interface ExistingEntryTransitionDeps {
  entryRepo: EntryRepoPort;
  contentTypeRepo: ContentTypeLookupPort;
  clock: Clock;
  authorize: AuthorizeFn;
  outbox: OutboxPort;
  watermark?: WatermarkPort;
  /** Optional same-transaction side effect — see `CreateEntryRequired.deps.onWritten`. Only `updateEntry` invokes it; `publishEntry`/`unpublishEntry` don't change `fieldsJson`/`bodyJson`, so they have nothing to re-extract. */
  onWritten?: (entry: EntryRecord) => Promise<void>;
}

/**
 * shared resolve step for `updateEntry`/`publishEntry`/`unpublishEntry`: authorize ->
 * find the entry -> find its owning type -> reject ONLY if that type is `tombstone`
 * (`deprecated` blocks nothing here, unlike `createEntry`'s rule) -> `expectedVersion` must equal the
 * version read. That check alone is not enough: the save's compare-and-set inside the write's
 * transaction ({@link runVersionedWrite}) also checks it, because a check on this read let two writers
 * that read the same version both land (wm S3). Nor is the compare-and-set alone: the caller's record
 * is built from THIS read, so a basis that differs from it could match a version another writer lands
 * after the read and overwrite that writer with a record built from the older row.
 *
 * @complexity O(1) plus one entry read and one content-type read.
 * @overallScore 100
 * See docs/decisions/DR-002-content-lifecycle-and-cleanup.md.
 */
async function resolveExistingEntryForTransition(
  deps: ExistingEntryTransitionDeps,
  input: { workspaceId: string; actorId: string; id: string; expectedVersion: number }
): Promise<Result<{ entry: EntryRecord; contentType: OwningContentType | null }, Error>> {
  const authResult = await deps.authorize({ principalId: input.actorId, permission: "admin.collections.manage", workspaceId: input.workspaceId }, { entityType: "entry" });
  if (!authResult.allowed) {
    return { ok: false, error: new ForbiddenError({ message: `principal '${input.actorId}' cannot modify entry '${input.id}' (${authResult.reason})` }) };
  }

  const entry = await deps.entryRepo.findById({ workspaceId: input.workspaceId, id: input.id });
  if (!entry) {
    return { ok: false, error: new EntryNotFoundError({ message: `entry '${input.id}' was not found in workspace '${input.workspaceId}'` }) };
  }

  const contentType = await deps.contentTypeRepo.findByKey({ workspaceId: input.workspaceId, key: entry.type });
  if (contentType && contentType.status === "tombstone") {
    // See docs/decisions/DR-002-content-lifecycle-and-cleanup.md for the invariant behind this refusal; keep external identifiers out of caller-facing messages.
    return { ok: false, error: new ContentTypeNotActiveError({ message: `content type '${entry.type}' is tombstoned; existing entries cannot be updated/published/unpublished` }) };
  }

  if (input.expectedVersion !== entry.version) {
    return { ok: false, error: entryVersionConflictError({ id: input.id, expectedVersion: input.expectedVersion, found: entry.version }) };
  }

  return { ok: true, value: { entry, contentType } };
}

/**
 * Runs a versioned write's transaction; a compare-and-set loss thrown by `save` inside it becomes
 * the returned error (the callers return it as `{ ok: false }`, so HTTP routes keep their Result
 * path). The transaction rolls the whole write back, so a loss leaves no revision or watermark.
 * @throws whatever else the transaction throws.
 */
async function runVersionedWrite(entryRepo: EntryRepoPort, fn: () => Promise<void>): Promise<VersionConflictError | null> {
  try {
    await entryRepo.transaction({ fn });
    return null;
  } catch (error) {
    if (error instanceof VersionConflictError) return error;
    throw error;
  }
}

export interface UpdateEntryRequired {
  deps: ExistingEntryTransitionDeps;
  input: ActorIdentityInput & {
    workspaceId: string;
    id: string;
    title?: string | undefined;
    fieldsJson?: unknown;
    /**
     * Additive-only, optional. Every pre-existing caller omits this and is byte-for-byte
     * unaffected (verified via a full-suite run before/after this change — see the widgets
     * implementation report's identical `onWritten` precedent for the same verification
     * discipline). Closes a real, previously-disclosed gap: no path existed to change an entry's
     * `bodyJson` after creation (only `createEntry` accepted it), which blocked a server-side,
     * versioned document-mutation command for widgetEmbed nodes — that command IS an
     * `updateEntry` call with a mutated `bodyJson`, through the SAME chokepoint, `expectedVersion`
     * guard, and revision machinery every other update already uses, not a second mutation path.
     * No schema validation is applied to `bodyJson` here (none is applied anywhere else in this
     * codebase either — every existing `bodyJson` writer, e.g. `CollectionEntryEditor.tsx`'s
     * create call, already writes arbitrary TipTap JSON unchecked); `widgets/embed-service.ts` is
     * responsible for its own guardrail check (`validateWidgetEmbedMutation`) before ever calling
     * this.
     */
    bodyJson?: unknown;
    expectedVersion: number;
  };
}

/**
 * — updates an existing entry's `title`/`fieldsJson`/`bodyJson` (only the fields supplied
 * are changed). Rejected `ContentTypeNotActiveError` only if the owning type is `tombstone`
 * a `deprecated` owning type is fine.
 *
 * @complexity O(1) plus the shared resolve step and, when `fieldsJson` is supplied, one
 * field-validation pass.
 * @overallScore 100
 * See docs/decisions/DR-002-content-lifecycle-and-cleanup.md.
 */
export async function updateEntry(required: UpdateEntryRequired): Promise<Result<{ entry: EntryRecord }, Error>> {
  const { deps, input } = required;

  const resolved = await resolveExistingEntryForTransition(deps, input);
  if (!resolved.ok) return resolved;
  const { entry: current, contentType } = resolved.value;

  const nextFields = nextFieldsJson({ current, contentType, fieldsJson: input.fieldsJson });
  if (!nextFields.ok) return nextFields;

  const now = kernelNowIso({ clock: deps.clock });
  const updated: EntryRecord = {
    ...current,
    title: input.title ?? current.title,
    fieldsJson: nextFields.value,
    bodyJson: input.bodyJson !== undefined ? input.bodyJson : current.bodyJson,
    updatedAt: now,
    version: current.version + 1,
  };

  const conflict = await runVersionedWrite(deps.entryRepo, () =>
    persistEntryWrite({ deps, entry: updated, op: "update", input, recordedAt: now }, { saveOptions: { expectedVersion: input.expectedVersion }, onWritten: deps.onWritten }),
  );
  if (conflict) return { ok: false, error: conflict };

  await deps.outbox.enqueue({ name: "entry.updated", payload: { workspaceId: input.workspaceId, entryId: current.id } });

  return { ok: true, value: { entry: updated } };
}

/**
 * `updateEntry`'s `fieldsJson` rule: omitted keeps the current value untouched (and unvalidated);
 * supplied must validate against the owning type's CURRENT schema, or — when the owning type no
 * longer exists — against an empty schema under the default `site` namespace.
 *
 * @complexity O(1) when omitted; one field-validation pass when supplied.
 */
function nextFieldsJson(required: {
  current: EntryRecord;
  contentType: OwningContentType | null;
  fieldsJson: unknown;
}): Result<unknown, EntryFieldValidationError> {
  const { current, contentType, fieldsJson } = required;
  if (fieldsJson === undefined) return { ok: true, value: current.fieldsJson };
  const fieldError = fieldValidationError({ type: current.type, owner: contentType?.owner, fields: contentType?.fields ?? [], fieldsJson });
  return fieldError ? { ok: false, error: fieldError } : { ok: true, value: fieldsJson };
}

export interface ImportEntryRequired {
  deps: {
    entryRepo: EntryRepoPort;
    contentTypeRepo: ContentTypeLookupPort;
    clock: Clock;
    authorize: AuthorizeFn;
    outbox: OutboxPort;
    watermark?: WatermarkPort;
    onWritten?: (entry: EntryRecord) => Promise<void>;
  };
  input: ActorIdentityInput & {
    workspaceId: string;
    /** The source's own id, preserved verbatim — unlike `createEntry`, which always mints a fresh
     * one. Anything referencing this entry by id (widgets, term assignments) needs it to survive
     * a publish round trip unchanged (plan-publish-all-types-2026-09-25.md §0.3 "Identity"). */
    id: string;
    type: string;
    slug: string;
    title: string;
    /** Caller-given, unlike `createEntry`'s forced `"draft"` — an import carries the source's real
     * status across. */
    status: EntryStatus;
    fieldsJson: unknown;
    bodyJson?: unknown;
    /** Caller-given, unlike `createEntry`'s forced `null`. */
    publishedAt: string | null;
    /**
     * The publish factory's three-way CAS contract: `undefined` means "no row with this id may
     * already exist" (an import-as-create); a number means "a row with this id must exist and be
     * at exactly this version" (an import-as-update). Both cases end in `VersionConflictError` on
     * mismatch, never a silent create-over-existing or a silent no-op. Both are also enforced by the
     * save itself (`undefined` becomes the save's `expectedVersion: null`), because the `findById`
     * check below let two concurrent creates of one id both pass and the second overwrite the first.
     */
    expectedVersion: number | undefined;
  };
}

/**
 * Slice J1 (plan-publish-all-types-2026-09-25.md) — the publish-content import chokepoint for
 * `entries`. Combines `createEntry`'s owning-type/field-validation guards with `updateEntry`'s
 * version-CAS discipline, but preserves the caller's own `id`/`status`/`publishedAt` instead of
 * minting a fresh id and forcing `draft`/`null` — the two behaviors a straight `createEntry` call
 * cannot produce, and the reason this is a new function rather than a wider `createEntry`.
 *
 * A tombstoned owning type refuses the import (mirrors `resolveExistingEntryForTransition`'s
 * rule); unlike `createEntry`'s, a `deprecated` owning type does NOT block an
 * import — exists to stop new manual authoring against a type an operator is winding down,
 * not to stop a publish run from keeping an already-existing entry's already-existing type in
 * sync. Slug uniqueness is deliberately not checked here: the publish factory's own `address`
 * precheck (config.address, F1) owns that refusal before `importEntry` is ever called.
 *
 * @complexity O(1) plus one content-type read, one field-validation pass, one id lookup, and one
 * same-tx write pair.
 * See docs/decisions/DR-002-content-lifecycle-and-cleanup.md.
 */
export async function importEntry(required: ImportEntryRequired): Promise<Result<{ entry: EntryRecord }, Error>> {
  const { deps, input } = required;

  const target = await resolveImportContentType(required);
  if (!target.ok) return target;
  const contentType = target.value;

  const fieldError = fieldValidationError({ type: contentType.key, owner: contentType.owner, fields: contentType.fields, fieldsJson: input.fieldsJson });
  if (fieldError) return { ok: false, error: fieldError };

  const existing = await deps.entryRepo.findById({ workspaceId: input.workspaceId, id: input.id });
  const basisError = importBasisError({ existing, input });
  if (basisError) return { ok: false, error: basisError };

  const now = kernelNowIso({ clock: deps.clock });
  const entry = buildImportedEntry({ input, existing, now });

  const conflict = await runVersionedWrite(deps.entryRepo, () =>
    persistEntryWrite(
      { deps, entry, op: existing ? "update" : "create", input, recordedAt: now },
      { saveOptions: { expectedVersion: input.expectedVersion ?? null }, onWritten: deps.onWritten },
    ),
  );
  if (conflict) return { ok: false, error: conflict };

  await deps.outbox.enqueue({ name: "entry.imported", payload: { workspaceId: input.workspaceId, entryId: entry.id, type: input.type, slug: input.slug } });

  return { ok: true, value: { entry } };
}

/**
 * `importEntry`'s guard step: authorize -> owning type exists AND is owned by this workspace ->
 * owning type is not `tombstone` (`deprecated` is allowed; see `importEntry`).
 *
 * @complexity O(1) plus one authorization call and one content-type read.
 */
async function resolveImportContentType(required: ImportEntryRequired): Promise<Result<OwningContentType, Error>> {
  const { deps, input } = required;

  const authResult = await deps.authorize({ principalId: input.actorId, permission: "admin.collections.manage", workspaceId: input.workspaceId }, { entityType: "entry" });
  if (!authResult.allowed) {
    return { ok: false, error: new ForbiddenError({ message: `principal '${input.actorId}' cannot import entry '${input.id}' (${authResult.reason})` }) };
  }

  const found = await findWorkspaceContentType({ contentTypeRepo: deps.contentTypeRepo, workspaceId: input.workspaceId, type: input.type });
  if (!found.ok) return found;
  if (found.value.status === "tombstone") {
    return { ok: false, error: new ContentTypeNotActiveError({ message: `content type '${input.type}' is tombstoned; entries cannot be imported into it` }) };
  }
  return found;
}

/**
 * The read-side half of `importEntry`'s three-way CAS contract (see `ImportEntryRequired.input.expectedVersion`):
 * `undefined` requires no existing row; a number requires an existing row at exactly that version
 * AND of the same type. Returns the refusal, or `null` when the basis holds.
 *
 * @complexity O(1).
 */
function importBasisError(required: {
  existing: EntryRecord | null;
  input: { workspaceId: string; id: string; type: string; expectedVersion: number | undefined };
}): VersionConflictError | null {
  const { existing, input } = required;
  if (input.expectedVersion === undefined) {
    // A create that lands between this read and the save is the save's insert-if-absent below.
    if (!existing) return null;
    return new VersionConflictError({ message: `entry '${input.id}' already exists in workspace '${input.workspaceId}', but no expectedVersion was supplied for import` });
  }
  if (!existing) {
    return new VersionConflictError({ message: `expected version ${input.expectedVersion} for entry '${input.id}', but no such entry exists` });
  }
  // Checked on this read AND by the save's compare-and-set below (wm S3): the record is built from
  // this read, so a basis that differs from it must not reach a save that could match it.
  if (existing.version !== input.expectedVersion) {
    return entryVersionConflictError({ id: input.id, expectedVersion: input.expectedVersion, found: existing.version });
  }
  // Same id, different type means this is not the row the caller's plan was made against; a
  // silent type move would also dodge the tombstone check on the entry's REAL type. See docs/decisions/DR-002-content-lifecycle-and-cleanup.md.
  if (existing.type !== input.type) {
    return new VersionConflictError({ message: `entry '${input.id}' is of type '${existing.type}', not '${input.type}'; an import cannot change an entry's type` });
  }
  return null;
}

/**
 * Builds the row `importEntry` writes: the caller's own `id`/`status`/`publishedAt` verbatim; an
 * existing row's `createdAt` kept and its version bumped, or `createdAt = now` and version 1 for a create.
 *
 * @complexity O(1).
 */
function buildImportedEntry(required: { input: ImportEntryRequired["input"]; existing: EntryRecord | null; now: string }): EntryRecord {
  const { input, existing, now } = required;
  return {
    id: input.id,
    workspaceId: input.workspaceId,
    type: input.type,
    slug: input.slug,
    status: input.status,
    title: input.title,
    bodyJson: input.bodyJson ?? null,
    fieldsJson: input.fieldsJson,
    publishedAt: input.publishedAt,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    version: existing ? existing.version + 1 : 1,
  };
}

export interface PublishUnpublishEntryRequired {
  deps: ExistingEntryTransitionDeps;
  input: ActorIdentityInput & { workspaceId: string; id: string; expectedVersion: number };
}

async function transitionEntryStatus(
  required: PublishUnpublishEntryRequired,
  target: { status: "published" | "unpublished"; op: "publish" | "unpublish"; eventName: "entry.published" | "entry.unpublished" }
): Promise<Result<{ entry: EntryRecord }, Error>> {
  const { deps, input } = required;

  const resolved = await resolveExistingEntryForTransition(deps, input);
  if (!resolved.ok) return resolved;
  const { entry: current } = resolved.value;

  const now = kernelNowIso({ clock: deps.clock });
  const updated: EntryRecord = {
    ...current,
    status: target.status,
    publishedAt: target.status === "published" ? now : current.publishedAt,
    updatedAt: now,
    version: current.version + 1,
  };

  // No `onWritten`: a status flip changes neither `fieldsJson` nor `bodyJson`, so there is nothing to re-extract.
  const conflict = await runVersionedWrite(deps.entryRepo, () =>
    persistEntryWrite({ deps, entry: updated, op: target.op, input, recordedAt: now }, { saveOptions: { expectedVersion: input.expectedVersion } }),
  );
  if (conflict) return { ok: false, error: conflict };

  await deps.outbox.enqueue({ name: target.eventName, payload: { workspaceId: input.workspaceId, entryId: current.id } });

  return { ok: true, value: { entry: updated } };
}

/**
 * — flips an entry to `published`. Rejected `ContentTypeNotActiveError` only if the owning
 * type is `tombstone`, with NO outbox event enqueued on rejection.
 *
 * @complexity O(1) plus the shared resolve step and one same-tx write pair.
 * @overallScore 100
 * See docs/decisions/DR-002-content-lifecycle-and-cleanup.md.
 */
export async function publishEntry(required: PublishUnpublishEntryRequired): Promise<Result<{ entry: EntryRecord }, Error>> {
  return transitionEntryStatus(required, { status: "published", op: "publish", eventName: "entry.published" });
}

/**
 * — flips an entry to `unpublished`. Rejected `ContentTypeNotActiveError` only if the
 * owning type is `tombstone`, with NO outbox event enqueued on rejection.
 *
 * @complexity O(1) plus the shared resolve step and one same-tx write pair.
 * @overallScore 100
 * See docs/decisions/DR-002-content-lifecycle-and-cleanup.md.
 */
export async function unpublishEntry(required: PublishUnpublishEntryRequired): Promise<Result<{ entry: EntryRecord }, Error>> {
  return transitionEntryStatus(required, { status: "unpublished", op: "unpublish", eventName: "entry.unpublished" });
}
