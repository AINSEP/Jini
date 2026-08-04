import type { ClockPort } from "../core/ports.js";
import {
  ContentTypeNotFoundError,
  ForbiddenError,
  InvalidFieldKindError,
  InvalidFieldNameGrammarError,
  InvalidKeyGrammarError,
  QueryableFieldCapExceededError,
  ReservedContentTypeKeyError,
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
 * reserved-key -> field-name grammar -> field-kind -> queryable-cap, evaluation stops at the
 * first failure. `updateContentTypeFields`'s CIC U-004-B1 additionally requires `expectedVersion`
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

/** Matches every other feature's chokepoint `AuthorizeFn` shape structurally — no shared import, kept decoupled. */
export type AuthorizeFn = (params: {
  principalId: string;
  permission: string;
  workspaceId: string;
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
  // Guard 3: field-name grammar (every field, before any kind/cap check).
  for (const field of input.fields) {
    if (!validateIdentifierGrammar(field.name)) {
      return { ok: false, error: new InvalidFieldNameGrammarError(`field name '${field.name}' fails the identifier grammar gate`) };
    }
  }
  // Guard 4: field-kind, closed enum.
  for (const field of input.fields) {
    if (!isContentTypeFieldKind(field.kind)) {
      return { ok: false, error: new InvalidFieldKindError(`field '${field.name}' has kind '${field.kind}', not one of the closed field-kind enum`) };
    }
  }
  // Guard 5: queryable-field cap, submitted array alone.
  if (countQueryableFields(input.fields) > QUERYABLE_FIELD_CAP) {
    return { ok: false, error: new QueryableFieldCapExceededError(`content type '${input.key}' submits more than ${QUERYABLE_FIELD_CAP} queryable fields`) };
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

  await deps.repo.transaction(async () => {
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
  });
  if (!authResult.allowed) {
    return { ok: false, error: new ForbiddenError(`principal '${input.actorId}' cannot update content type '${input.key}' (${authResult.reason})`) };
  }

  const current = await deps.repo.findByKey({ workspaceId: input.workspaceId, key: input.key });
  if (!current) {
    return { ok: false, error: new ContentTypeNotFoundError(`content type '${input.key}' was not found in workspace '${input.workspaceId}'`) };
  }

  // U-004-B1: expectedVersion checked FIRST — before fields_empty, before any per-field guard.
  if (input.expectedVersion !== current.version) {
    return { ok: false, error: new VersionConflictError(`expected version ${input.expectedVersion} for content type '${input.key}', found ${current.version}`) };
  }

  if (input.fields.length === 0) {
    return { ok: false, error: new ValidationError(`content type '${input.key}' update submitted an empty fields array`, "fields_empty") };
  }

  for (const field of input.fields) {
    if (!validateIdentifierGrammar(field.name)) {
      return { ok: false, error: new InvalidFieldNameGrammarError(`field name '${field.name}' fails the identifier grammar gate`) };
    }
  }
  for (const field of input.fields) {
    if (!isContentTypeFieldKind(field.kind)) {
      return { ok: false, error: new InvalidFieldKindError(`field '${field.name}' has kind '${field.kind}', not one of the closed field-kind enum`) };
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
