import { nowIso as kernelNowIso } from "@jini-ai/core/primitives";
import type { Clock } from "@jini-ai/core/primitives";
import {
  ContentTypeNotActiveError,
  ContentTypeNotFoundError,
  EntryFieldValidationError,
  EntryNotFoundError,
  EntrySlugConflictError,
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
  /** The version the caller read; the save throws `VersionConflictError` unless the stored live row still holds it. */
  expectedVersion?: number | undefined;
}

export interface EntryRepoPort {
  findBySlug(params: { workspaceId: string; type: string; slug: string }): Promise<EntryRecord | null>;
  findById(params: { workspaceId: string; id: string }): Promise<EntryRecord | null>;
  /**
   * Writes `row` by id. With `expectedVersion`, the write is a compare-and-set: it lands only when the
   * stored live (not trashed) row still holds that version, checked atomically with the write (one
   * conditional UPDATE in a SQL adapter), so two writers that read the same version cannot both land.
   * Without it, the write is unconditional (create, import-as-create, trash seams).
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

  const contentType = await deps.contentTypeRepo.findByKey({ workspaceId: input.workspaceId, key: input.type });
  if (!contentType || contentType.workspaceId !== input.workspaceId) {
    return { ok: false, error: new ContentTypeNotFoundError({ message: `content type '${input.type}' was not found in workspace '${input.workspaceId}'` }) };
  }
  if (contentType.status !== "active") {
    // See docs/decisions/DR-002-content-lifecycle-and-cleanup.md for the invariant behind this refusal; keep external identifiers out of caller-facing messages.
    return { ok: false, error: new ContentTypeNotActiveError({ message: `content type '${input.type}' is not active; new entries cannot be created` }) };
  }

  // The envelope namespace comes from the owning TYPE, never the caller (2026-10-04). It used to be
  // `input.owner` defaulting to "site": the generic entries route passed none, so a widget-owned
  // type's payload validated under `ext.site` and wrote a row the widgets reader could never parse.
  // The same rule holds in `updateEntry` and `importEntry` below.
  const validation = validateFieldsAgainstSchema({ schema: contentType.fields, fieldsJson: input.fieldsJson }, { owner: contentType.owner });
  if (!validation.valid) {
    return { ok: false, error: new EntryFieldValidationError({ fieldErrors: validation.fieldErrors }) };
  }

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

  await deps.entryRepo.transaction({ fn: async () => {
    await deps.entryRepo.save(entry);
    await deps.entryRepo.appendRevision({
      entryId: entry.id,
      workspaceId: input.workspaceId,
      op: "create",
      stateJson: entry,
      actorId: input.actorId,
      ...delegationFields(input),
      recordedAt: now,
    });
    if (deps.watermark) await deps.watermark.stampWatermark({ workspaceId: input.workspaceId });
    if (deps.onWritten) await deps.onWritten(entry);
  } });

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
 * (`deprecated` blocks nothing here, unlike `createEntry`'s rule). The `expectedVersion` check is
 * NOT here: it is the save's compare-and-set inside the write's transaction ({@link runVersionedWrite}),
 * because a check on this read let two writers that read the same version both land (wm S3).
 *
 * @complexity O(1) plus one entry read and one content-type read.
 * @overallScore 100
 * See docs/decisions/DR-002-content-lifecycle-and-cleanup.md.
 */
async function resolveExistingEntryForTransition(
  deps: ExistingEntryTransitionDeps,
  input: { workspaceId: string; actorId: string; id: string }
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

  let fieldsJson = current.fieldsJson;
  if (input.fieldsJson !== undefined) {
    const validation = validateFieldsAgainstSchema({ schema: contentType?.fields ?? [], fieldsJson: input.fieldsJson }, { owner: contentType?.owner });
    if (!validation.valid) {
      return { ok: false, error: new EntryFieldValidationError({ fieldErrors: validation.fieldErrors }) };
    }
    fieldsJson = input.fieldsJson;
  }

  const now = kernelNowIso({ clock: deps.clock });
  const updated: EntryRecord = {
    ...current,
    title: input.title ?? current.title,
    fieldsJson,
    bodyJson: input.bodyJson !== undefined ? input.bodyJson : current.bodyJson,
    updatedAt: now,
    version: current.version + 1,
  };

  const conflict = await runVersionedWrite(deps.entryRepo, async () => {
    await deps.entryRepo.save(updated, { expectedVersion: input.expectedVersion });
    await deps.entryRepo.appendRevision({
      entryId: current.id,
      workspaceId: input.workspaceId,
      op: "update",
      stateJson: updated,
      actorId: input.actorId,
      ...delegationFields(input),
      recordedAt: now,
    });
    if (deps.watermark) await deps.watermark.stampWatermark({ workspaceId: input.workspaceId });
    if (deps.onWritten) await deps.onWritten(updated);
  });
  if (conflict) return { ok: false, error: conflict };

  await deps.outbox.enqueue({ name: "entry.updated", payload: { workspaceId: input.workspaceId, entryId: current.id } });

  return { ok: true, value: { entry: updated } };
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
     * mismatch, never a silent create-over-existing or a silent no-op.
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

  const authResult = await deps.authorize({ principalId: input.actorId, permission: "admin.collections.manage", workspaceId: input.workspaceId }, { entityType: "entry" });
  if (!authResult.allowed) {
    return { ok: false, error: new ForbiddenError({ message: `principal '${input.actorId}' cannot import entry '${input.id}' (${authResult.reason})` }) };
  }

  const contentType = await deps.contentTypeRepo.findByKey({ workspaceId: input.workspaceId, key: input.type });
  if (!contentType || contentType.workspaceId !== input.workspaceId) {
    return { ok: false, error: new ContentTypeNotFoundError({ message: `content type '${input.type}' was not found in workspace '${input.workspaceId}'` }) };
  }
  if (contentType.status === "tombstone") {
    return { ok: false, error: new ContentTypeNotActiveError({ message: `content type '${input.type}' is tombstoned; entries cannot be imported into it` }) };
  }

  const validation = validateFieldsAgainstSchema({ schema: contentType.fields, fieldsJson: input.fieldsJson }, { owner: contentType.owner });
  if (!validation.valid) {
    return { ok: false, error: new EntryFieldValidationError({ fieldErrors: validation.fieldErrors }) };
  }

  const existing = await deps.entryRepo.findById({ workspaceId: input.workspaceId, id: input.id });
  if (input.expectedVersion === undefined) {
    if (existing) {
      return { ok: false, error: new VersionConflictError({ message: `entry '${input.id}' already exists in workspace '${input.workspaceId}', but no expectedVersion was supplied for import` }) };
    }
  } else {
    if (!existing) {
      return { ok: false, error: new VersionConflictError({ message: `expected version ${input.expectedVersion} for entry '${input.id}', but no such entry exists` }) };
    }
    // A version mismatch is the save's compare-and-set below, not a check on this read (wm S3).
    // Same id, different type means this is not the row the caller's plan was made against; a
    // silent type move would also dodge the tombstone check on the entry's REAL type. See docs/decisions/DR-002-content-lifecycle-and-cleanup.md.
    if (existing.type !== input.type) {
      return { ok: false, error: new VersionConflictError({ message: `entry '${input.id}' is of type '${existing.type}', not '${input.type}'; an import cannot change an entry's type` }) };
    }
  }

  const now = kernelNowIso({ clock: deps.clock });
  const entry: EntryRecord = {
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

  const conflict = await runVersionedWrite(deps.entryRepo, async () => {
    await deps.entryRepo.save(entry, { expectedVersion: input.expectedVersion });
    await deps.entryRepo.appendRevision({
      entryId: entry.id,
      workspaceId: input.workspaceId,
      op: existing ? "update" : "create",
      stateJson: entry,
      actorId: input.actorId,
      ...delegationFields(input),
      recordedAt: now,
    });
    if (deps.watermark) await deps.watermark.stampWatermark({ workspaceId: input.workspaceId });
    if (deps.onWritten) await deps.onWritten(entry);
  });
  if (conflict) return { ok: false, error: conflict };

  await deps.outbox.enqueue({ name: "entry.imported", payload: { workspaceId: input.workspaceId, entryId: entry.id, type: input.type, slug: input.slug } });

  return { ok: true, value: { entry } };
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

  const conflict = await runVersionedWrite(deps.entryRepo, async () => {
    await deps.entryRepo.save(updated, { expectedVersion: input.expectedVersion });
    await deps.entryRepo.appendRevision({
      entryId: current.id,
      workspaceId: input.workspaceId,
      op: target.op,
      stateJson: updated,
      actorId: input.actorId,
      ...delegationFields(input),
      recordedAt: now,
    });
    if (deps.watermark) await deps.watermark.stampWatermark({ workspaceId: input.workspaceId });
  });
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
