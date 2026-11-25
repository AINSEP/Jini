import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { createEntry, entriesDeps, entryWriteErrorStatus, type EntriesToolDeps } from "../../../entries/index.js";
import { authorizeCollections, collectionsBody, collectionsPrincipal, rejectValidation, rejectWriteFailure, type CollectionsOutwardErrorDeps, type CollectionsRouteBody, type CollectionsRoutePrincipal, type OkValue, type OutboxDrainDeps } from "../content-types/collections-route.js";

/** The deps this route reads. */
export interface EntryCreateRouteDeps extends EntriesToolDeps, OutboxDrainDeps, CollectionsOutwardErrorDeps {}

/** What a successful create answers (201). */
export type EntryCreateOutput = OkValue<Awaited<ReturnType<typeof createEntry>>>;

/** This route's required `type`/`slug`/`title` (strings) plus the optional `fieldsJson`/`bodyJson`
 *  fields, read off an untyped body in one place. `null` means the required strings failed
 *  validation. @complexity O(1). */
function parseCreateEntryBody({ rawBody }: { rawBody: unknown }, _optional = {}): { type: string; slug: string; title: string; fieldsJson: unknown; bodyJson: unknown } | null {
  const body = (rawBody ?? {}) as Record<string, unknown>;
  if (typeof body.type !== "string" || typeof body.slug !== "string" || typeof body.title !== "string") return null;
  return {
    type: body.type,
    slug: body.slug,
    title: body.title,
    fieldsJson: body.fieldsJson ?? { ext: { site: {} } },
    bodyJson: body.bodyJson,
  };
}

/**
 * @file design-spec.md §1.5/§1.9 — `POST /api/admin/v1/entries` (creates a Collection entry,
 * REQ-13/14/19). Gated by `admin.collections.manage`.
 */
export const entryCreateRoute = defineJsonRoute<CollectionsRouteBody, EntryCreateOutput, EntryCreateRouteDeps, CollectionsRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/entries",
  parse: (raw) => ok({ value: { body: collectionsBody({ raw }) } }),
  handle: async ({ input, deps, context, authorize }) => {
    const principal = collectionsPrincipal({ context });
    await authorizeCollections({ authorize, permission: "admin.collections.manage", entityType: "entry" });

    const parsedBody = parseCreateEntryBody({ rawBody: input.body });
    if (!parsedBody) rejectValidation({ error: "'type', 'slug', and 'title' (strings) are required" });

    const result = await createEntry({
      deps: entriesDeps(deps),
      input: { actorId: principal.id, actor: { id: principal.id, kind: "user" }, workspaceId: deps.workspaceId, ...parsedBody },
    });
    if (!result.ok) rejectWriteFailure({ error: result.error, statusOf: entryWriteErrorStatus, outwardErrorMessage: deps.outwardErrorMessage });

    // 2026-09-03 outbox-drain audit fix — drains the outbox so `createEntry`'s `entry.created`
    // event reaches `bus.subscribe`d consumers before the response rather than on the background
    // drainer's next pass (mirrors the posts update route's identical inline drain).
    await deps.drainOutbox();
    return ok({ value: result.value });
  },
}, { successStatus: 201 });
