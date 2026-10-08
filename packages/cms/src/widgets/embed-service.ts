import { isNonArrayRecord } from "@jini-ai/core";
/**
 * @file Server-side, versioned document-mutation command for `widgetEmbed` nodes (SPEC-043
 * REQ-44/45, ADR-047 Debate Fold-In Amendment 6).
 *
 * Purpose:
 * The second entry point into the SAME document-mutation contract the live TipTap editor's own
 * Save path uses — both ultimately write through `features/entries/write-service.ts`'s
 * `updateEntry` chokepoint, the same `expectedVersion` OCC guard, and the same revision machinery.
 * Usable with no browser editor session open (an AI agent, or a server-side script). Enforces
 * REQ-19/20's guardrails (no widget-in-widget recursion, per-document embed-count clamp) via
 * `embed-validation.ts`'s `validateWidgetEmbedMutation` — the ONE validator both this path and the
 * live editor's own chokepoint-side hook must call, so the two paths can never silently diverge
 * (INV-04).
 *
 * Closes a real, previously-disclosed gap this file's own domain depends on: `updateEntry` had no
 * parameter to change `bodyJson` after creation (only `createEntry` did) — fixed additively in
 * `features/entries/write-service.ts` as part of this same dispatch (see that file's `bodyJson`
 * doc comment) rather than worked around here.
 *
 * Architectural role:
 * `widgets` domain logic (implementation outline C-007), landing in this later routes/UI/AI-tools
 * dispatch rather than the earlier domain-layer session, since it composes `updateEntry`'s new
 * `bodyJson` capability which did not exist yet at that time.
 */
import type { Clock as ClockPort, JsonObject, JsonValue, UUID } from "@jini-ai/core/primitives";
import type { ChangeSetRepoPort, CommandActor, OutboxPort } from "../core/index.js";
import { ForbiddenError, executeCommand } from "../core/index.js";
import type { EntryRefsRepoPort } from "./ports.js";

import type { ContentTypeRepoPort } from "../content-types/index.js";
import type { EntryRecord, EntryRepoPort } from "../entries/index.js";
import type { WidgetHostPorts, BeforeSaveHookPort, PostRecord, ForgetRemovedPostFn, PostRepoPort } from "./host-ports.js";
import {
  PRE_AUTHORIZED,
  requireWidgetPermission,
  type WidgetsAuthorizeFn,
} from "./authorize-helper.js";
import { withEntryLock } from "./concurrency.js";
import { validateWidgetEmbedMutation } from "./embed-validation.js";
import { parseWidgetInstancePayload } from "./entry-payload.js";
import {
  WidgetEmbedGuardrailError,
  WidgetEmbedHostNotFoundError,
  WidgetEmbedHostUnsupportedError,
  WidgetEmbedPlacementNotFoundError,
  WidgetForbiddenError,
  WidgetInstanceNotFoundError,
  WidgetVersionConflictError,
} from "./errors.js";
import { WIDGET_AREA_CONTENT_TYPE, WIDGET_CONTENT_TYPE } from "./types.js";
import type { WidgetEmbedNode } from "./types.js";

/** Matches the certified `embed-validation.unit.test.ts` suite's own value — no separate policy
 * config surface exists yet for this (OQ-level detail, same disclosure posture as OQ-01's resolver
 * timeout). */
const DEFAULT_MAX_EMBEDS_PER_DOCUMENT = 50;

export interface EmbedServiceDeps {
  host: Pick<WidgetHostPorts, "entries" | "entryRefs" | "posts">;
  entryRepo: EntryRepoPort;
  contentTypeRepo: ContentTypeRepoPort;
  entryRefsRepo: EntryRefsRepoPort;
  /** REQ-44 — a post/page host is a second, separate table (see `loadEmbedHost`'s doc). */
  postRepo: PostRepoPort;
  /**
   * Required by `restorePostForward`, which this service's `rollback` calls. Nothing here ever
   * trashes a post, so it can never actually fire — but the dependency is required rather than
   * optional on purpose: an optional compensation port is how one gets wired at three call sites
   * out of four. See `post.ts`'s {@link ForgetRemovedPostFn}.
   */
  forgetRemovedPost: ForgetRemovedPostFn;
  /** The same command-gateway change-set store the live editor's own post-save route uses, so a
   *  post/page embed write records an auditable, revertible change set identically (ADR-047
   *  Amendment 6). */
  changeSets: ChangeSetRepoPort;
  clock: ClockPort;
  ids: { newId: () => string };
  authorize: WidgetsAuthorizeFn;
  outbox: OutboxPort;
  /** Same optional "absent = zero-plugin behavior unchanged" contract as `UpdatePostDeps.beforeSaveHook`. */
  beforeSaveHook?: BeforeSaveHookPort;
  /** REQ-20 — policy-bounded, not hardcoded; defaults to `DEFAULT_MAX_EMBEDS_PER_DOCUMENT`. */
  maxEmbedsPerDocument?: number;
}

/** Walks a TipTap-shaped `bodyJson` tree collecting every `widgetEmbed` node, in document order. */
function collectEmbeds(root: unknown, out: WidgetEmbedNode[]): void {
  // An explicit stack, not recursion: a host body's nesting depth is caller/import-controlled and a
  // 5000-deep body overflowed the call stack here on every embed save (same class as f646ba397's
  // GET-path walkers). Children are pushed in reverse so the walk stays pre-order — document order,
  // which `reorderWidgetEmbeds` relies on.
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    const candidate = { value: node };
    const attrs = { value: isNonArrayRecord(candidate) && candidate.value.type === "widgetEmbed" ? candidate.value.attrs : undefined };
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) stack.push(node[i]);
      continue;
    }
    if (!isNonArrayRecord(candidate)) continue;
    if (
      isNonArrayRecord(attrs) &&
      typeof attrs.value.placementId === "string" &&
      typeof attrs.value.widgetEntryId === "string"
    ) {
      out.push({ type: "widgetEmbed", placementId: attrs.value.placementId, widgetEntryId: attrs.value.widgetEntryId });
    }
    if (Array.isArray(candidate.value.content)) stack.push(candidate.value.content);
  }
}

function widgetEmbedNode(placementId: UUID, widgetEntryId: UUID): JsonValue {
  return { type: "widgetEmbed", attrs: { placementId, widgetEntryId } };
}

/** Appends one new `widgetEmbed` node to the end of the document's top-level `content` array — the
 * simplest well-defined "insert" position for a server-side/no-editor caller (an arbitrary cursor
 * position is a live-editor-only concept; REQ-44 requires the mutation exist, not that it target an
 * arbitrary offset). Falls back to a fresh empty doc if `bodyJson` isn't already a TipTap-shaped
 * doc node (e.g. a still-empty entry). */
function appendEmbed(bodyJson: unknown, placementId: UUID, widgetEntryId: UUID): JsonValue {
  const body = { value: bodyJson };
  const doc = isNonArrayRecord(body) && body.value.type === "doc" ? body.value : { type: "doc", content: [] };
  const content = Array.isArray(doc.content) ? doc.content : [];
  return { ...doc, content: [...content, widgetEmbedNode(placementId, widgetEntryId)] };
}

/** Removes every `widgetEmbed` node matching `placementId`, at any depth, preserving every other
 * node's position — mirrors the tree-shape-preserving discipline `reorderEmbeds` below also uses. */
function isEmbedWithPlacementId(node: unknown, placementId: UUID): boolean {
  const candidate = { value: node };
  const attrs = { value: isNonArrayRecord(candidate) && candidate.value.type === "widgetEmbed" ? candidate.value.attrs : undefined };
  return isNonArrayRecord(candidate) && isNonArrayRecord(attrs) && attrs.value.placementId === placementId;
}

/** Whether `removeEmbedByPlacementId` would remove anything — same match, so the two never disagree. */
function containsEmbedWithPlacementId({ node: root, placementId }: { node: unknown; placementId: UUID }, _optional = {}): boolean {
  // Stored/imported nesting is unbounded; keep the complete walk off the JavaScript call stack.
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    const candidate = { value: node };
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) stack.push(node[i]);
    } else if (isEmbedWithPlacementId(node, placementId)) {
      return true;
    } else if (isNonArrayRecord(candidate) && Array.isArray(candidate.value.content)) {
      stack.push(candidate.value.content);
    }
  }
  return false;
}

function removeEmbedByPlacementId({ node: root, placementId }: { node: unknown; placementId: UUID }, _optional = {}): unknown {
  let result: unknown;
  // Each task assigns one transformed child to its copied parent; no recursive reconstruction
  // or mutation of the original document (which is also the write's inverse/revision state).
  const stack: Array<{ node: unknown; assign: (value: unknown) => void }> = [
    { node: root, assign: (value) => { result = value; } },
  ];
  while (stack.length > 0) {
    const { node, assign } = stack.pop()!;
    const candidate = { value: node };
    if (Array.isArray(node)) {
      const children = node.filter((child) => !isEmbedWithPlacementId(child, placementId));
      const copy: unknown[] = new Array(children.length);
      assign(copy);
      for (let i = children.length - 1; i >= 0; i--) {
        stack.push({ node: children[i], assign: (value) => { copy[i] = value; } });
      }
    } else if (isNonArrayRecord(candidate) && Array.isArray(candidate.value.content)) {
      const copy = { ...candidate.value };
      assign(copy);
      stack.push({ node: candidate.value.content, assign: (value) => { copy.content = value; } });
    } else {
      assign(node);
    }
  }
  return result;
}

/** Reassigns which widget occupies which EXISTING embed slot, in document order, per
 * `orderedWidgetEntryIds` — the document's shape (surrounding paragraphs/headings, slot count and
 * position) is unchanged; only each slot's `widgetEntryId` is swapped. `placementId`s move with
 * their new `widgetEntryId` (a fresh placement identity per REQ-44's "reorder" being a distinct
 * operation from "insert") so `entry_refs` re-extraction after the write reflects the new mapping
 * cleanly rather than aliasing stale target ids to a slot that no longer represents them. */
function reorderEmbedSlots({ node: root, newIds, orderedWidgetEntryIds }: {
  node: unknown;
  newIds: () => UUID;
  orderedWidgetEntryIds: readonly UUID[];
}, _optional = {}): unknown {
  let result: unknown;
  let index = 0;
  const stack: Array<{ node: unknown; assign: (value: unknown) => void }> = [
    { node: root, assign: (value) => { result = value; } },
  ];
  while (stack.length > 0) {
    const { node, assign } = stack.pop()!;
    const candidate = { value: node };
    const attrs = { value: isNonArrayRecord(candidate) && candidate.value.type === "widgetEmbed" ? candidate.value.attrs : undefined };
    if (Array.isArray(node)) {
      const copy: unknown[] = new Array(node.length);
      assign(copy);
      // Reverse push preserves pre-order, including new placement-id allocation order.
      for (let i = node.length - 1; i >= 0; i--) {
        stack.push({ node: node[i], assign: (value) => { copy[i] = value; } });
      }
    } else if (isNonArrayRecord(candidate) && isNonArrayRecord(attrs)) {
      // reorderWidgetEmbeds validates one supplied id per existing embed slot.
      assign(widgetEmbedNode(newIds(), orderedWidgetEntryIds[index++]!));
    } else if (isNonArrayRecord(candidate) && Array.isArray(candidate.value.content)) {
      const copy = { ...candidate.value };
      assign(copy);
      stack.push({ node: candidate.value.content, assign: (value) => { copy.content = value; } });
    } else {
      assign(node);
    }
  }
  return result;
}

async function extractAndStoreEmbedRefs(
  deps: EmbedServiceDeps,
  workspaceId: string,
  host: { id: UUID; type: string; bodyJson: unknown }
): Promise<void> {
  const refs = deps.host.entryRefs.extract({
    workspaceId,
    sourceEntryId: host.id,
    sourceEntryType: host.type,
    bodyJson: host.bodyJson,
    fieldsExt: {},
  });
  await deps.entryRefsRepo.replaceForSource({ workspaceId, sourceEntryId: host.id, refs });
}

/** A `widgetEmbed` host is either a custom content-type `entries` row (the original host table) or
 *  a `posts` row (REQ-44) — a Post/Page is NOT an `entries` row (`resolver-service.ts:60-67`
 *  documents this same split for the render-time lookup this mirrors on the write side). Checked
 *  entries-first so every existing entries-host behavior stays byte-identical (D1); IDs are UUIDs,
 *  so a same-id collision across the two tables is not a realistic case. */
type EmbedHost = { kind: "entry"; record: EntryRecord } | { kind: "post"; record: PostRecord };

async function loadEmbedHost(deps: EmbedServiceDeps, workspaceId: UUID, hostEntryId: UUID): Promise<EmbedHost> {
  const entry = await deps.entryRepo.findById({ workspaceId, id: hostEntryId });
  if (entry) {
    if (entry.type === WIDGET_AREA_CONTENT_TYPE) {
      // REQ-17 (D4) — a widget_area entry is itself a region's composition document; it must never
      // also be a widgetEmbed host (no recursion into a region from inside a region).
      throw new WidgetEmbedHostUnsupportedError({ message: `host '${hostEntryId}' is a widget_area entry, which can never host a widgetEmbed node (REQ-17)`, reason: "widget-area" }
      );
    }
    return { kind: "entry", record: entry };
  }

  const post = await deps.postRepo.findById({ workspaceId, id: hostEntryId });
  if (!post || deps.host.posts.isTrashed(post)) {
    throw new WidgetEmbedHostNotFoundError({ message: `host entry '${hostEntryId}' was not found in workspace '${workspaceId}' (it must be the id of an existing, non-trashed post, page, or content entry)` }
    );
  }
  if (post.bodyFormat === "html") {
    // An html-format Page (SPEC-047) has no Tiptap body — `data-embed-config` markers are its embed
    // mechanism instead (`html-embeds.ts`), not a `widgetEmbed` node.
    throw new WidgetEmbedHostUnsupportedError({ message: `host '${hostEntryId}' is an HTML-format page, which has no rich-text body for widgetEmbed nodes; embed widgets in it with a data-embed-config marker of type "widget" via pages_write_region or pages_write_html instead`, reason: "html-page" }
    );
  }
  return { kind: "post", record: post };
}

/** The content/entity type `assertGuardrails` validates against — an entry's registered content
 *  type for an entries host, or the post/page `kind` for a posts-table host. */
function hostBodyType(host: EmbedHost): string {
  return host.kind === "entry" ? host.record.type : host.record.kind;
}

/**
 * REQ-16/17 (Fable adversarial-review fix, 2026-07-21, Finding E): mirrors
 * `region-area-service.ts`'s identical REQ-16 placement check, previously asymmetric — a region
 * placement referencing a nonexistent/trashed/wrong-type widget was rejected before any write, but
 * `insertWidgetEmbed` inserted the embed node regardless, silently degrading to the render-time
 * placeholder instead of failing at write time the way region placement does. Also enforces REQ-17
 * (a `widget_area` entry must never itself be an embed target) via the same `type !==
 * WIDGET_CONTENT_TYPE` check region placement already uses to exclude it.
 */
async function assertEmbedTargetIsLiveWidget(deps: EmbedServiceDeps, workspaceId: UUID, widgetEntryId: UUID): Promise<void> {
  const widget = await deps.entryRepo.findById({ workspaceId, id: widgetEntryId });
  if (!widget || widget.type !== WIDGET_CONTENT_TYPE) {
    throw new WidgetInstanceNotFoundError({ message: `embed references widget '${widgetEntryId}', which does not exist in workspace '${workspaceId}' (REQ-16/17)` });
  }
  const payload = parseWidgetInstancePayload({ fieldsJson: widget.fieldsJson });
  if (payload.status === "trash" || payload.status === "purged") {
    throw new WidgetInstanceNotFoundError({ message: `embed references widget '${widgetEntryId}', which is trashed (REQ-16)` });
  }
}

/** REQ-19/20: validates the resulting embed set BEFORE writing — the same guardrail the live
 * editor's own chokepoint-side hook must call (INV-04), never bypassable from this path. */
function assertGuardrails(deps: EmbedServiceDeps, hostEntryType: string, resultingBodyJson: unknown): void {
  const resultingEmbeds: WidgetEmbedNode[] = [];
  collectEmbeds(resultingBodyJson, resultingEmbeds);
  const result = validateWidgetEmbedMutation({
    hostEntryType,
    resultingEmbeds,
    maxEmbedsPerDocument: deps.maxEmbedsPerDocument ?? DEFAULT_MAX_EMBEDS_PER_DOCUMENT,
  });
  if (!result.valid) {
    throw new WidgetEmbedGuardrailError({ message: `widgetEmbed mutation on host entry rejected: ${result.reason} (REQ-19/20)`, reason: result.reason }
    );
  }
}

async function writeHostBody(
  deps: EmbedServiceDeps,
  workspaceId: UUID,
  actor: { principalId: UUID },
  current: EntryRecord,
  baseVersion: number,
  nextBodyJson: unknown
): Promise<EntryRecord> {
  const result = await deps.host.entries.updateEntry({
    deps: {
      entryRepo: deps.entryRepo,
      contentTypeRepo: deps.contentTypeRepo,
      clock: deps.clock,
      authorize: PRE_AUTHORIZED,
      // Bridges the raw, full-`DomainEvent` infra port (`EmbedServiceDeps.outbox`) into the
      // narrower `{enqueue({name,payload})}` shape `updateEntry` declares locally — same fix,
      // same reasoning as `write-service.ts`'s `entriesWriteDeps` helper (only one call site
      // here, so inlined rather than factored out). Previously `deps.outbox` was forwarded
      // unwrapped, which compiled but threw `NOT NULL constraint failed: outbox_events.id`
      // against the real SQLite outbox on every embed insert/remove/reorder.
      outbox: deps.host.entries.toEntryOutbox({ outbox: deps.outbox, clock: deps.clock, idGen: deps.ids, workspaceId }),
      onWritten: (entry) => extractAndStoreEmbedRefs(deps, workspaceId, entry),
    },
    input: {
      actorId: actor.principalId,
      workspaceId,
      id: current.id,
      bodyJson: nextBodyJson,
      expectedVersion: baseVersion,
    },
  });
  if (!result.ok) {
    if (deps.host.entries.isVersionConflict(result.error)) {
      const latest = await deps.entryRepo.findById({ workspaceId, id: current.id });
      throw new WidgetVersionConflictError({ message: result.error.message, currentVersion: latest?.version ?? current.version });
    }
    throw result.error;
  }
  return result.value.entry;
}

/** REQ-44's post/page host arm — writes through the SAME command-gateway + `updatePost` chokepoint
 *  the live TipTap editor's own Save path uses (`routes/posts/update.ts`), so a post/page embed
 *  mutation gets an identical change-set/rollback unit of work (ADR-047 Amendment 6, D2). Only
 *  `bodyJson` actually changes; every other field travels through unchanged from `current`.
 *
 *  Unlike the entries arm above — which re-extracts `entry_refs` inside `updateEntry`'s `onWritten`,
 *  within that chokepoint's own transaction — the refs refresh here runs AFTER `executeCommand` has
 *  committed, because the command gateway exposes no in-transaction hook. A refs write that fails
 *  therefore leaves the post saved with stale refs (where-used over-reports, and the non-force purge
 *  guard fails safe by blocking). Accepted, not overlooked. */
async function writePostHostBody(
  deps: EmbedServiceDeps,
  workspaceId: UUID,
  actor: { principalId: UUID; kind: string },
  current: PostRecord,
  baseVersion: number,
  nextBodyJson: unknown
): Promise<PostRecord> {
  let priorPost: PostRecord | null = null;
  try {
    const { result } = await executeCommand({
      deps: {
        clock: deps.clock,
        idGen: deps.ids,
        changeSets: deps.changeSets,
        outbox: deps.outbox,
        authorize: deps.authorize,
      },
      command: {
        workspaceId,
        actor: { id: actor.principalId, kind: actor.kind as CommandActor["kind"] },
        summary: `Update widgetEmbed placements on post ${current.id}`,
        permission: "content.write",
      },
      mutation: {
        entityType: "post",
        entityId: current.id,
        operation: "update",
        captureInverse: async () => {
          priorPost = await deps.postRepo.findById({ workspaceId, id: current.id });
          if (!priorPost) return null;
          return {
            title: priorPost.title,
            slug: priorPost.slug,
            bodyJson: priorPost.bodyJson,
            status: priorPost.status,
            templateChoice: priorPost.templateChoice ?? null,
            overridesThemePage: priorPost.overridesThemePage ?? null,
            ...(priorPost.ext !== undefined ? { ext: priorPost.ext } : {}),
          };
        },
        execute: () =>
          deps.host.posts.updatePost({
            deps: {
              repo: deps.postRepo,
              clock: deps.clock,
              outbox: deps.outbox,
              beforeSaveHook: deps.beforeSaveHook,
            },
            input: {
              workspaceId,
              id: current.id,
              title: current.title,
              slug: current.slug,
              status: current.status,
              bodyJson: nextBodyJson as JsonObject,
              expectedVersion: baseVersion,
              actorId: actor.principalId,
              // `actor.kind` is this call's real provenance ("user" for the admin HTTP routes,
              // "agent" for the widget tool surface — see `InsertWidgetEmbedInput.actor`'s own
              // doc). Only a non-"user" kind is delegated — mirrors `tool-registrations.ts`'s
              // identical delegatedBy* convention for `post_revisions` attribution.
              delegatedByWorkspaceId: actor.kind === "user" ? undefined : workspaceId,
              delegatedById: actor.kind === "user" ? undefined : actor.principalId,
            },
          }),
        captureEntityVersion: ({ result }) => result.post.version,
        rollback: async () => {
          if (!priorPost) return;
          await deps.host.posts.restorePostForward({
            deps: {
              repo: deps.postRepo,
              clock: deps.clock,
              outbox: deps.outbox,
              forgetRemoved: deps.forgetRemovedPost,
            },
            input: {
              prior: priorPost,
              actorId: actor.principalId,
              // Mirrors the forward write's own delegatedBy* convention just above.
              delegatedByWorkspaceId: actor.kind === "user" ? undefined : workspaceId,
              delegatedById: actor.kind === "user" ? undefined : actor.principalId,
            },
          });
        },
      },
    });
    await extractAndStoreEmbedRefs(deps, workspaceId, { id: result.post.id, type: result.post.kind, bodyJson: result.post.bodyJson });
    return result.post;
  } catch (err) {
    if (deps.host.posts.isVersionConflict(err)) {
      throw new WidgetVersionConflictError({ message: err.message, currentVersion: err.currentVersion });
    }
    if (deps.host.posts.isNotFound(err)) {
      // Trash race between `loadEmbedHost`'s check and this write — same not-found shape either way.
      throw new WidgetEmbedHostNotFoundError({ message: `host entry '${current.id}' was not found in workspace '${workspaceId}' (it must be the id of an existing, non-trashed post, page, or content entry)` }
      );
    }
    if (err instanceof ForbiddenError) {
      // Reformatted to match `authorize-helper.ts`'s `requireWidgetPermission` wording (not
      // `executeCommand`'s own message verbatim) so `widgetForbiddenToResponse`'s regex extracts
      // `permission`/`reason` identically regardless of which of the two gates rejected the caller.
      throw new WidgetForbiddenError({ message: `principal '${actor.principalId}' lacks permission 'content.write' (${err.reason})` });
    }
    throw err;
  }
}

export interface InsertWidgetEmbedInput {
  readonly workspaceId: UUID;
  readonly actor: { readonly principalId: UUID; readonly kind: string };
  readonly hostEntryId: UUID;
  readonly baseVersion: number;
  readonly widgetEntryId: UUID;
}

export interface InsertWidgetEmbedRequired {
  deps: EmbedServiceDeps;
  input: InsertWidgetEmbedInput;
}

/** REQ-44/45: inserts a new `widgetEmbed` node referencing `widgetEntryId`, appended to the host
 * entry's body — one atomic, version-guarded write through the same chokepoint the live editor's
 * Save uses. Returns the newly-minted `placementId` so the caller (an agent tool, or the
 * server-side embed-mutation routes) can address this exact placement afterward. */
export async function insertWidgetEmbed(required: InsertWidgetEmbedRequired, _optional: Record<string, never> = {}): Promise<{ entry: EntryRecord | PostRecord; placementId: UUID }> {
  const { deps, input } = required;
  await requireWidgetPermission({
    authorize: deps.authorize,
    actor: input.actor,
    workspaceId: input.workspaceId,
    permission: "widgets.place",
  });

  return withEntryLock({ key: `${input.workspaceId}::${input.hostEntryId}`, fn: async () => {
    const host = await loadEmbedHost(deps, input.workspaceId, input.hostEntryId);
    await assertEmbedTargetIsLiveWidget(deps, input.workspaceId, input.widgetEntryId);
    const placementId = deps.ids.newId();
    const nextBodyJson = appendEmbed(host.record.bodyJson, placementId, input.widgetEntryId);
    assertGuardrails(deps, hostBodyType(host), nextBodyJson);
    const entry =
      host.kind === "entry"
        ? await writeHostBody(deps, input.workspaceId, input.actor, host.record, input.baseVersion, nextBodyJson)
        : await writePostHostBody(deps, input.workspaceId, input.actor, host.record, input.baseVersion, nextBodyJson);
    return { entry, placementId };
  } });
}

export interface RemoveWidgetEmbedInput {
  readonly workspaceId: UUID;
  readonly actor: { readonly principalId: UUID; readonly kind: string };
  readonly hostEntryId: UUID;
  readonly baseVersion: number;
  readonly placementId: UUID;
}

export interface RemoveWidgetEmbedRequired {
  deps: EmbedServiceDeps;
  input: RemoveWidgetEmbedInput;
}

/** REQ-44/45: removes the `widgetEmbed` node matching `placementId` from the host entry's body —
 * the placement itself is removed (the widget instance it referenced is untouched). */
export async function removeWidgetEmbed(required: RemoveWidgetEmbedRequired, _optional: Record<string, never> = {}): Promise<{ entry: EntryRecord | PostRecord }> {
  const { deps, input } = required;
  await requireWidgetPermission({
    authorize: deps.authorize,
    actor: input.actor,
    workspaceId: input.workspaceId,
    permission: "widgets.place",
  });

  return withEntryLock({ key: `${input.workspaceId}::${input.hostEntryId}`, fn: async () => {
    const host = await loadEmbedHost(deps, input.workspaceId, input.hostEntryId);
    if (!containsEmbedWithPlacementId({ node: host.record.bodyJson, placementId: input.placementId })) {
      // C4d fix: `removeEmbedByPlacementId` is a no-op filter — without this check a stale/bogus
      // placementId fell through to `writeHostBody` unchanged and reported success while writing
      // nothing.
      throw new WidgetEmbedPlacementNotFoundError({ message: `no widget embed with placementId '${input.placementId}' was found in host '${input.hostEntryId}'` }
      );
    }
    const nextBodyJson = removeEmbedByPlacementId({ node: host.record.bodyJson, placementId: input.placementId });
    assertGuardrails(deps, hostBodyType(host), nextBodyJson);
    const entry =
      host.kind === "entry"
        ? await writeHostBody(deps, input.workspaceId, input.actor, host.record, input.baseVersion, nextBodyJson)
        : await writePostHostBody(deps, input.workspaceId, input.actor, host.record, input.baseVersion, nextBodyJson);
    return { entry };
  } });
}

export interface ReorderWidgetEmbedsInput {
  readonly workspaceId: UUID;
  readonly actor: { readonly principalId: UUID; readonly kind: string };
  readonly hostEntryId: UUID;
  readonly baseVersion: number;
  /** The new widget-entry order, one id per EXISTING embed slot in the host's body, in document
   * order — must be the same length as the number of `widgetEmbed` nodes currently present. */
  readonly orderedWidgetEntryIds: readonly UUID[];
}

export interface ReorderWidgetEmbedsRequired {
  deps: EmbedServiceDeps;
  input: ReorderWidgetEmbedsInput;
}

export class WidgetEmbedReorderCountMismatchError extends Error {
  readonly expectedCount: number;
  readonly actualCount: number;
  constructor({ message, expectedCount, actualCount }: { message: string; expectedCount: number; actualCount: number }, _optional: Record<string, never> = {}
  ) {
    super(message);
    this.expectedCount = expectedCount;
    this.actualCount = actualCount;
    this.name = "WidgetEmbedReorderCountMismatchError";
  }
}

/** REQ-44/45: reassigns which widget occupies which existing embed slot, in document order — the
 * document's own shape (slot count/position, surrounding content) is unchanged. Rejects a count
 * mismatch before writing anything (the caller must supply exactly one id per existing slot). */
export async function reorderWidgetEmbeds(required: ReorderWidgetEmbedsRequired, _optional: Record<string, never> = {}): Promise<{ entry: EntryRecord | PostRecord }> {
  const { deps, input } = required;
  await requireWidgetPermission({
    authorize: deps.authorize,
    actor: input.actor,
    workspaceId: input.workspaceId,
    permission: "widgets.place",
  });

  return withEntryLock({ key: `${input.workspaceId}::${input.hostEntryId}`, fn: async () => {
    const host = await loadEmbedHost(deps, input.workspaceId, input.hostEntryId);

    const existing: WidgetEmbedNode[] = [];
    collectEmbeds(host.record.bodyJson, existing);
    if (existing.length !== input.orderedWidgetEntryIds.length) {
      throw new WidgetEmbedReorderCountMismatchError({ message: `reorder must supply exactly one widgetEntryId per existing embed slot (${existing.length} present, ${input.orderedWidgetEntryIds.length} supplied)`, expectedCount: existing.length, actualCount: input.orderedWidgetEntryIds.length }
      );
    }

    // Round-2 external-audit fix (2026-07-21, codex WIDGETS-R2-001/blocker): reorder assigns NEW
    // widgetEntryId values to slots (see reorderEmbedSlots below) exactly like insertWidgetEmbed
    // does, but never got the same REQ-16/17 target-existence/liveness/type check — an authorized
    // widgets.place caller could persist a nonexistent, wrong-type, trashed, or cross-workspace id
    // (codex reproduced both a numeric id and a dangling entry_refs row for "does-not-exist").
    // Every distinct replacement target is validated before the host document or entry_refs change.
    for (const widgetEntryId of new Set(input.orderedWidgetEntryIds)) {
      if (typeof widgetEntryId !== "string" || widgetEntryId.length === 0) {
        throw new WidgetInstanceNotFoundError({ message: "reorder contains an invalid widgetEntryId" });
      }
      await assertEmbedTargetIsLiveWidget(deps, input.workspaceId, widgetEntryId);
    }

    const nextBodyJson = reorderEmbedSlots({ node: host.record.bodyJson, newIds: () => deps.ids.newId(), orderedWidgetEntryIds: input.orderedWidgetEntryIds });
    assertGuardrails(deps, hostBodyType(host), nextBodyJson);
    const entry =
      host.kind === "entry"
        ? await writeHostBody(deps, input.workspaceId, input.actor, host.record, input.baseVersion, nextBodyJson)
        : await writePostHostBody(deps, input.workspaceId, input.actor, host.record, input.baseVersion, nextBodyJson);
    return { entry };
  } });
}
