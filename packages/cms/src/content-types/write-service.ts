import { EntityNotLiveError } from "../core/entity-liveness.js";
import type { ClockPort } from "../core/ports.js";
import {
  ContentTypeAlreadyExistsError,
  ContentTypeNotFoundError,
  ForbiddenError,
  InvalidFieldKindError,
  InvalidFieldNameGrammarError,
  InvalidKeyGrammarError,
  QueryableFieldCapExceededError,
  ReservedContentTypeKeyError,
  StorageOnlyFieldNotQueryableError,
  ValidationError,
  VersionConflictError,
} from "./errors.js";
import { resolveFieldIndexTransition, validateIdentifierGrammar } from "./index-provisioning.js";
import {
  type ActorIdentityInput,
  type ActorPrincipalKind,
  type ContentTypeFieldDef,
  type ContentTypeRecord,
  type Result,
  isContentTypeFieldKind,
  isIndexableFieldKind,
} from "./types.js";

/**
 * @file Write-service — `registerContentType`/`updateContentTypeFields`, the single write
 * chokepoint for the `content_types` registry.
 *
 * Purpose:
 * The ONLY path that creates or full-replaces a content type's field schema. Every export here:
 * `authorize()` first (fail-closed) -> the fixed definition-time guard sequence (CIC U-002-B1) ->
 * same-transaction row + revision write (+ watermark stamp when supplied) -> index provisioning.
 *
 * `registerContentType`'s CIC U-002-B1 guard order is binding, not incidental: key grammar ->
 * reserved-key -> field-name grammar -> field-kind -> storage-only-not-queryable -> queryable-cap,
 * evaluation stops at the first failure. The storage-only check is numbered 4b rather than
 * renumbering 5, because the fixed order is pinned by name in the certified suite and the existing
 * five guards keep both their relative order and their identity: 4b sits strictly between the
 * field-kind check and the queryable-cap check, and can only fire on a field whose kind already
 * passed guard 4. `updateContentTypeFields`'s CIC U-004-B1 additionally requires `expectedVersion`
 * to be checked BEFORE the `fields_empty` floor and before any per-field guard, so a stale
 * `expectedVersion` combined with `fields: []` reports `VERSION_CONFLICT`, never
 * `VALIDATION_ERROR(fields_empty)`.
 *
 * How it relates to the project:
 * `deps.watermark` (REQ-01/INV-08) and the actor-identity delegation fields
 * (`delegatedByWorkspaceId`/`delegatedById`, REQ-16) are both optional/additive — every
 * pre-existing call site that omits them is unaffected; `watermark-stamping.integration.test.ts`
 * exercises both.
 *
 * Architectural role:
 * `features/content-types` domain logic. Depends only on `core/ports` and this package's own
 * `errors.ts`/`index-provisioning.ts`/`types.ts` — no adapter, no other feature.
 */

/**
 * Matches every other feature's chokepoint `AuthorizeFn` shape structurally — no shared import,
 * kept decoupled. `entityType`/`entityId` let `registerContentType`/`updateContentTypeFields`
 * (and `lifecycle.ts`'s three transitions, which import this same type) pass
 * `entityType: "content-type"` — matching every fronting HTTP route's own
 * `entityType: "content-type"` pre-check. See `entries/write-service.ts`'s identical `AuthorizeFn`
 * doc for why an omitted `entityType` here previously denied a content-type-scoped-only grant with
 * `resource_scope_mismatch` even though the route's pre-check allowed it, and why this chokepoint —
 * not the route — is the one that must stay at least as expressive.
 */
export type AuthorizeFn = (params: {
  principalId: string;
  permission: string;
  workspaceId: string;
  entityType?: string | undefined;
  entityId?: string | undefined;
}) => Promise<{ allowed: boolean; reason: string }>;

export interface ContentTypeRevisionInput {
  contentTypeKey: string;
  workspaceId: string;
  op: "register" | "field-change";
  stateJson: ContentTypeRecord;
  actorId: string;
  /**
   * Audit provenance — the actor CLASS behind `actorId` (`'user'` for a human admin request,
   * `'agent'` for a write made through the assistant's tool surface, `'system'` for an internal
   * boot-time registration). `null` when the caller did not supply one; see
   * `ActorIdentityInput.principalKind` for why `actorId` alone cannot answer the audit question.
   */
  principalKind: ActorPrincipalKind | null;
  delegatedByWorkspaceId: string | null;
  delegatedById: string | null;
  recordedAt: string;
}

export interface ContentTypeRepoPort {
  save(row: ContentTypeRecord): Promise<void>;
  appendRevision(revision: ContentTypeRevisionInput): Promise<void>;
  findByKey(params: { workspaceId: string; key: string }): Promise<ContentTypeRecord | null>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}

export interface IndexProvisionerPort {
  provisionIndexesForNewContentType(input: {
    workspaceId: string;
    contentTypeKey: string;
    fields: ContentTypeFieldDef[];
  }): Promise<void>;
  applyFieldIndexTransitions(input: {
    workspaceId: string;
    contentTypeKey: string;
    transitions: Array<{ fieldName: string; action: "provision" | "teardown" | "reprovision" }>;
  }): Promise<void>;
}

export interface OutboxPort {
  enqueue(event: { name: string; payload: Record<string, unknown> }): Promise<void>;
}

/** Optional (REQ-01/INV-08) — advances `database_write_watermark` by exactly 1 when supplied. */
export interface WatermarkPort {
  stampWatermark(input: { workspaceId: string }): Promise<number>;
}

export interface ContentTypeWriteServiceDeps {
  repo: ContentTypeRepoPort;
  clock: ClockPort;
  ids: { newId: () => string };
  authorize: AuthorizeFn;
  indexProvisioner: IndexProvisionerPort;
  outbox: OutboxPort;
  watermark?: WatermarkPort;
}

/** Reserved forever for the legacy `posts` table — an operator Collection can never take these keys. */
/**
 * Field-name guards shared by register and update, in order: every name passes the identifier
 * grammar (`InvalidFieldNameGrammarError`), THEN no name appears twice
 * (`VALIDATION_ERROR(fields_duplicate_name)`). Duplicates are refused because entry values are
 * stored keyed by field name and the index-transition diff builds a name-keyed map, so two defs
 * sharing a name leave one of them unaddressable (last one wins). Returns `null` when both pass.
 *
 * @complexity O(f) in the number of submitted fields.
 */
function fieldNameError(fields: ReadonlyArray<{ name: string }>): Error | null {
  for (const field of fields) {
    if (!validateIdentifierGrammar(field.name)) {
      return new InvalidFieldNameGrammarError(`field name '${field.name}' fails the identifier grammar gate`);
    }
  }
  const seen = new Set<string>();
  for (const field of fields) {
    if (seen.has(field.name)) {
      return new ValidationError(`field name '${field.name}' appears more than once`, "fields_duplicate_name");
    }
    seen.add(field.name);
  }
  return null;
}

const RESERVED_CONTENT_TYPE_KEYS = new Set(["post", "page"]);

/** Per-type cap on `queryable` fields (queryable-index sprawl mitigation). */
const QUERYABLE_FIELD_CAP = 20;

function countQueryableFields(fields: ContentTypeFieldDef[]): number {
  return fields.filter((f) => f.queryable).length;
}

export interface RegisterContentTypeRequired {
  deps: ContentTypeWriteServiceDeps;
  input: ActorIdentityInput & {
    workspaceId: string;
    key: string;
    label: string;
    fields: ContentTypeFieldDef[];
  };
}

/**
 * REQ-01..08 — registers a new content type. Guard order is CIC U-002-B1, fixed and stop-at-first-
 * failure: key grammar -> reserved-key -> field-name grammar -> field-kind -> queryable-cap.
 *
 * @complexity O(f) in the number of submitted fields (two guard passes over `fields`).
 * @overallScore 100
 */
export async function registerContentType(
  required: RegisterContentTypeRequired
): Promise<Result<{ contentType: ContentTypeRecord }, Error>> {
  const { deps, input } = required;

  const authResult = await deps.authorize({
    principalId: input.actorId,
    permission: "admin.collections.manage",
    workspaceId: input.workspaceId,
    entityType: "content-type",
  });
  if (!authResult.allowed) {
    return { ok: false, error: new ForbiddenError(`principal '${input.actorId}' cannot register a content type (${authResult.reason})`) };
  }

  // Guard 1: key grammar.
  if (!validateIdentifierGrammar(input.key)) {
    return { ok: false, error: new InvalidKeyGrammarError(`content-type key '${input.key}' fails the identifier grammar gate ^[a-z][a-z0-9_]{0,63}$`) };
  }
  // Guard 2: reserved key.
  if (RESERVED_CONTENT_TYPE_KEYS.has(input.key)) {
    return { ok: false, error: new ReservedContentTypeKeyError(`key '${input.key}' is permanently reserved for the legacy 'posts' table`) };
  }
  // Guard 3: field-name grammar, then uniqueness (every field, before any kind/cap check).
  const nameErrorOnRegister = fieldNameError(input.fields);
  if (nameErrorOnRegister) return { ok: false, error: nameErrorOnRegister };
  // Guard 4: field-kind, closed enum.
  for (const field of input.fields) {
    if (!isContentTypeFieldKind(field.kind)) {
      return { ok: false, error: new InvalidFieldKindError(`field '${field.name}' has kind '${field.kind}', not one of the closed field-kind enum`) };
    }
  }
  // Guard 4b: a storage-only kind cannot be queryable. Placed strictly between guard 4 and guard 5
  // so a bad kind still reports as a kind error, and a legal-but-unindexable kind is rejected
  // BEFORE the cap count and long before `resolveFieldIndexTransition` could hand it to the index
  // provisioner. This is the check that keeps a kind with no CAST target off the DDL path.
  for (const field of input.fields) {
    if (field.queryable && !isIndexableFieldKind(field.kind)) {
      return {
        ok: false,
        error: new StorageOnlyFieldNotQueryableError(
          `field '${field.name}' has storage-only kind '${field.kind}' and cannot be queryable`
        ),
      };
    }
  }
  // Guard 5: queryable-field cap, submitted array alone.
  if (countQueryableFields(input.fields) > QUERYABLE_FIELD_CAP) {
    return { ok: false, error: new QueryableFieldCapExceededError(`content type '${input.key}' submits more than ${QUERYABLE_FIELD_CAP} queryable fields`) };
  }

  // Row 7 — a pre-check outside the transaction. Not race-safe by itself (that's the in-tx check
  // below), but it avoids opening a transaction for the overwhelmingly common not-found case.
  const existingBeforeTx = await deps.repo.findByKey({ workspaceId: input.workspaceId, key: input.key });
  if (existingBeforeTx) {
    return { ok: false, error: new ContentTypeAlreadyExistsError(input.key, existingBeforeTx.status === "tombstone") };
  }

  const now = deps.clock.nowIso();
  const contentType: ContentTypeRecord = {
    workspaceId: input.workspaceId,
    key: input.key,
    label: input.label,
    fields: input.fields,
    status: "active",
    version: 1,
    tombstonedAt: null,
  };

  try {
    await deps.repo.transaction(async () => {
      // The check that actually closes the race: two concurrent first-widget creates both see the
      // pre-check above return null, but only one of them can win this in-tx re-check before save.
      const existingInTx = await deps.repo.findByKey({ workspaceId: input.workspaceId, key: input.key });
      if (existingInTx) {
        throw new ContentTypeAlreadyExistsError(input.key, existingInTx.status === "tombstone");
      }
      await deps.repo.save(contentType);
      await deps.repo.appendRevision({
        contentTypeKey: input.key,
        workspaceId: input.workspaceId,
        op: "register",
        stateJson: contentType,
        actorId: input.actorId,
        principalKind: input.principalKind ?? null,
        delegatedByWorkspaceId: input.delegatedByWorkspaceId ?? null,
        delegatedById: input.delegatedById ?? null,
        recordedAt: now,
      });
      if (deps.watermark) await deps.watermark.stampWatermark({ workspaceId: input.workspaceId });
    });
  } catch (err) {
    if (err instanceof ContentTypeAlreadyExistsError) return { ok: false, error: err };
    throw err;
  }

  // Index provisioning runs only once the transaction has committed a new row — never on the
  // already-exists path above.
  await deps.indexProvisioner.provisionIndexesForNewContentType({
    workspaceId: input.workspaceId,
    contentTypeKey: input.key,
    fields: input.fields,
  });

  return { ok: true, value: { contentType } };
}

export interface UpdateContentTypeFieldsRequired {
  deps: ContentTypeWriteServiceDeps;
  input: ActorIdentityInput & {
    workspaceId: string;
    key: string;
    fields: ContentTypeFieldDef[];
    expectedVersion: number;
  };
}

/**
 * REQ-26 — full-replace of a content type's field schema. CIC U-004-B1: `expectedVersion` is
 * checked BEFORE the `fields_empty` floor and before any per-field guard, so a stale version
 * combined with an empty array reports `VERSION_CONFLICT`, never `VALIDATION_ERROR`.
 *
 * @complexity O(f) in the number of submitted fields.
 * @overallScore 100
 */
export async function updateContentTypeFields(
  required: UpdateContentTypeFieldsRequired
): Promise<Result<{ contentType: ContentTypeRecord }, Error>> {
  const { deps, input } = required;

  const authResult = await deps.authorize({
    principalId: input.actorId,
    permission: "admin.collections.manage",
    workspaceId: input.workspaceId,
    entityType: "content-type",
  });
  if (!authResult.allowed) {
    return { ok: false, error: new ForbiddenError(`principal '${input.actorId}' cannot update content type '${input.key}' (${authResult.reason})`) };
  }

  const current = await deps.repo.findByKey({ workspaceId: input.workspaceId, key: input.key });
  if (!current) {
    return { ok: false, error: new ContentTypeNotFoundError(`content type '${input.key}' was not found in workspace '${input.workspaceId}'`) };
  }
  // Row 15's sibling — a tombstoned type is terminal (INV-06); this check runs before the version
  // check so a stale-version update against a tombstoned row still reports "tombstoned", not
  // "version conflict" (the tombstone tore down every queryable index, so the schema is moot).
  if (current.status === "tombstone") {
    return { ok: false, error: new EntityNotLiveError("content type", input.key, "tombstoned") };
  }

  // U-004-B1: expectedVersion checked FIRST — before fields_empty, before any per-field guard.
  if (input.expectedVersion !== current.version) {
    return { ok: false, error: new VersionConflictError(`expected version ${input.expectedVersion} for content type '${input.key}', found ${current.version}`) };
  }

  if (input.fields.length === 0) {
    return { ok: false, error: new ValidationError(`content type '${input.key}' update submitted an empty fields array`, "fields_empty") };
  }

  const nameErrorOnUpdate = fieldNameError(input.fields);
  if (nameErrorOnUpdate) return { ok: false, error: nameErrorOnUpdate };
  for (const field of input.fields) {
    if (!isContentTypeFieldKind(field.kind)) {
      return { ok: false, error: new InvalidFieldKindError(`field '${field.name}' has kind '${field.kind}', not one of the closed field-kind enum`) };
    }
  }
  // Guard 4b: a storage-only kind cannot be queryable. Placed strictly between guard 4 and guard 5
  // so a bad kind still reports as a kind error, and a legal-but-unindexable kind is rejected
  // BEFORE the cap count and long before `resolveFieldIndexTransition` could hand it to the index
  // provisioner. This is the check that keeps a kind with no CAST target off the DDL path.
  for (const field of input.fields) {
    if (field.queryable && !isIndexableFieldKind(field.kind)) {
      return {
        ok: false,
        error: new StorageOnlyFieldNotQueryableError(
          `field '${field.name}' has storage-only kind '${field.kind}' and cannot be queryable`
        ),
      };
    }
  }
  if (countQueryableFields(input.fields) > QUERYABLE_FIELD_CAP) {
    return { ok: false, error: new QueryableFieldCapExceededError(`content type '${input.key}' submits more than ${QUERYABLE_FIELD_CAP} queryable fields`) };
  }

  const before = current.fields;
  const after = input.fields;
  const now = deps.clock.nowIso();
  const updated: ContentTypeRecord = { ...current, fields: after, version: current.version + 1 };

  await deps.repo.transaction(async () => {
    await deps.repo.save(updated);
    await deps.repo.appendRevision({
      contentTypeKey: input.key,
      workspaceId: input.workspaceId,
      op: "field-change",
      stateJson: updated,
      actorId: input.actorId,
      principalKind: input.principalKind ?? null,
      delegatedByWorkspaceId: input.delegatedByWorkspaceId ?? null,
      delegatedById: input.delegatedById ?? null,
      recordedAt: now,
    });
    if (deps.watermark) await deps.watermark.stampWatermark({ workspaceId: input.workspaceId });
  });

  await deps.indexProvisioner.applyFieldIndexTransitions({
    workspaceId: input.workspaceId,
    contentTypeKey: input.key,
    transitions: computeFullReplaceTransitions(before, after),
  });

  return { ok: true, value: { contentType: updated } };
}

/**
 * CIC U-003-B1 composition — resolves an index transition for every field name present on either
 * side of a full-replace update (union of before/after names), one before/after comparison per
 * name, and returns only the actionable (non-`"none"`) transitions.
 *
 * @complexity O(f) in the number of distinct field names across both arrays.
 * @overallScore 100
 */
function computeFullReplaceTransitions(
  before: ContentTypeFieldDef[],
  after: ContentTypeFieldDef[]
): Array<{ fieldName: string; action: "provision" | "teardown" | "reprovision" }> {
  const beforeByName = new Map(before.map((f) => [f.name, f]));
  const afterByName = new Map(after.map((f) => [f.name, f]));
  const allNames = new Set([...beforeByName.keys(), ...afterByName.keys()]);

  const transitions: Array<{ fieldName: string; action: "provision" | "teardown" | "reprovision" }> = [];
  for (const name of allNames) {
    const b = beforeByName.get(name);
    const a = afterByName.get(name);
    const transition = resolveFieldIndexTransition({
      before: b ? { kind: b.kind, queryable: b.queryable } : undefined,
      after: a ? { kind: a.kind, queryable: a.queryable } : undefined,
    });
    if (transition.action !== "none") {
      transitions.push({ fieldName: name, action: transition.action });
    }
  }
  return transitions;
}
