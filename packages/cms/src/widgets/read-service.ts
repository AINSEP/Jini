/**
 * @file Widget-instance READ accessors (SPEC-043 REQ-04) — `write-service.ts` only ever exported
 * create/update/trash/purge; this file is the missing `widgets.read`-gated get/list side, named
 * separately per `features/entries`' own `write-service.ts`/`list.ts` split convention.
 *
 * External /audit-work finding (2026-07-21, ADR-047): confirmed no read/list accessor existed in
 * this package at all — the admin `get-by-id`/`list` routes (`routes/admin/widgets/*.ts`) this
 * dispatch builds depend on it directly.
 *
 * Disclosed, not silently omitted: REQ-04 also asks for "its full revision history." No revision-
 * READ capability exists anywhere in `features/entries` today for ANY content type (confirmed:
 * `EntryRepoPort` only exposes `appendRevision`, never a corresponding list/read method — neither
 * `InMemoryEntryRepo` nor `SqliteEntryRepo` exposes one either, even as an extra, non-port method).
 * That is a real, pre-existing gap in the shared chokepoint, not a widgets-specific hole, and
 * meaningfully larger than the two additive fixes this dispatch already made to
 * `features/entries/write-service.ts` (the `onWritten` hook, the `bodyJson` parameter) — it needs
 * its own port + both adapters, a bigger shared-module change than this dispatch is authorized to
 * make unilaterally. `getWidgetInstance` below returns current state only; `revisions: []` is
 * returned as an honest placeholder shape (not a silently-dropped field) so callers/tests have a
 * stable contract to code against once the underlying capability lands.
 *
 * Architectural role:
 * `widgets` domain logic, read side.
 */
import type { UUID } from "@jini-ai/core/primitives";
import type { EntryListPort, EntryRepoPort } from "../entries/index.js";
import { requireWidgetPermission, type WidgetsAuthorizeFn } from "./authorize-helper.js";
import { WidgetInstanceNotFoundError } from "./errors.js";
import { toWidgetInstanceEntry } from "./entry-payload.js";
import { WIDGET_CONTENT_TYPE } from "./types.js";
import type { WidgetInstanceEntry } from "./types.js";

export interface WidgetReadServiceDeps {
  entryRepo: EntryRepoPort & EntryListPort;
  authorize: WidgetsAuthorizeFn;
}

export interface GetWidgetInstanceInput {
  readonly workspaceId: UUID;
  readonly actor: { readonly principalId: UUID };
  readonly widgetInstanceId: UUID;
}

export interface GetWidgetInstanceRequired {
  deps: WidgetReadServiceDeps;
  input: GetWidgetInstanceInput;
}

/** REQ-04: read a widget instance's current state (+ revision history — see this file's header for
 * the disclosed gap on that half). Returns any status (`active`/`trash`/`purged`) — the caller
 * decides whether a non-`active` instance is presentable (e.g. an admin editor still shows a
 * trashed instance so it can be restored/inspected).
 *
 * `widgetInstanceId` is resolved slug-first, id-second — same order/rationale as posts'
 * `getAdminPostByIdOrSlug` (`src/features/post/post.ts`) and forms'
 * `resolveFormDefinitionByIdOrSlug` (`server/inbound/admin-http/routes/forms/resolve-definition.ts`):
 * the admin widget editor's URL now carries the widget's slug (`WidgetsLibrary.tsx`'s row link,
 * `use-widget-instance-editor.hooks.ts`'s create-navigate), so this param may itself BE that slug.
 * An old id-based bookmark/link still resolves via the `findById` fallback. */
export async function getWidgetInstance(required: GetWidgetInstanceRequired, _optional: Record<string, never> = {}): Promise<{ instance: WidgetInstanceEntry; revisions: [] }> {
  const { deps, input } = required;
  await requireWidgetPermission({
    authorize: deps.authorize,
    actor: input.actor,
    workspaceId: input.workspaceId,
    permission: "widgets.read",
  });

  const bySlug = await deps.entryRepo.findBySlug({
    workspaceId: input.workspaceId,
    type: WIDGET_CONTENT_TYPE,
    slug: input.widgetInstanceId.trim().toLowerCase(),
  });
  const entry = bySlug ?? (await deps.entryRepo.findById({ workspaceId: input.workspaceId, id: input.widgetInstanceId }));
  if (!entry || entry.type !== WIDGET_CONTENT_TYPE) {
    throw new WidgetInstanceNotFoundError({ message: `widget instance '${input.widgetInstanceId}' was not found` });
  }
  return { instance: toWidgetInstanceEntry({ entry: entry }), revisions: [] };
}

export interface ListWidgetInstancesInput {
  readonly workspaceId: UUID;
  readonly actor: { readonly principalId: UUID };
  /** Narrow to one widget type; omitted lists every type (mirrors `EntryListPort.listByWorkspace`'s
   * own optional-`type` shape). */
  readonly widgetType?: string;
  /** Excludes `trash`/`purged` instances by default — the library screen's default view (REQ-04
   * read access still covers reading a specific trashed instance directly via `getWidgetInstance`,
   * this is only the list's default filter). */
  readonly includeInactive?: boolean;
}

export interface ListWidgetInstancesRequired {
  deps: WidgetReadServiceDeps;
  input: ListWidgetInstancesInput;
}

export async function listWidgetInstances(
  required: ListWidgetInstancesRequired, _optional: Record<string, never> = {}
): Promise<{ instances: WidgetInstanceEntry[]; skippedCount: number; skippedIds: string[] }> {
  const { deps, input } = required;
  await requireWidgetPermission({
    authorize: deps.authorize,
    actor: input.actor,
    workspaceId: input.workspaceId,
    permission: "widgets.read",
  });

  const rows = await deps.entryRepo.listByWorkspace({ workspaceId: input.workspaceId }, { type: WIDGET_CONTENT_TYPE });
  const instances: WidgetInstanceEntry[] = [];
  let skippedCount = 0;
  const skippedIds: string[] = [];
  for (const row of rows) {
    let instance: WidgetInstanceEntry;
    try {
      instance = toWidgetInstanceEntry({ entry: row });
    } catch {
      // A malformed widget-instance row (e.g. wiped by an unrelated generic-entry update that
      // bypassed this feature's own write path) is skipped, not a 500 for the whole admin library
      // screen (Fable adversarial-review fix, 2026-07-21, Finding B).
      //
      // 2026-08-03 (dossier C5 follow-up): the skip itself was silent — nothing recorded that a row
      // never reached the caller, so a genuinely corrupted widget could vanish from the library with
      // zero trace. Kept the skip (a malformed row must not 500 the whole screen), added a
      // server-side log line plus returned count and IDs so it's observable instead of invisible.
      // Deliberately logs only `row.id`/`workspaceId`, never `row.fieldsJson` — a malformed payload
      // may hold arbitrary caller-supplied content, and this line is not the place to disclose it.
      console.warn("[widgets] listWidgetInstances: skipping malformed widget-instance row", {
        entryId: row.id,
        workspaceId: input.workspaceId,
      });
      skippedCount += 1;
      skippedIds.push(row.id);
      continue;
    }
    if (input.widgetType && instance.widgetType !== input.widgetType) continue;
    if (!input.includeInactive && instance.status !== "active") continue;
    instances.push(instance);
  }
  return { instances, skippedCount, skippedIds };
}
