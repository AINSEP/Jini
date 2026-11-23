import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { entriesDeps, entryWriteErrorStatus, updateEntry, type EntriesToolDeps } from "../../../entries/index.js";
import { authorizeCollections, collectionsBody, collectionsPrincipal, rejectValidation, rejectWriteFailure, type CollectionsRouteBody, type CollectionsRoutePrincipal, type OkValue, type OutboxDrainDeps } from "../content-types/collections-route.js";

/** The deps this route reads. */
export interface EntryUpdateRouteDeps extends EntriesToolDeps, OutboxDrainDeps {}

/** The entry id plus the untyped PUT body. */
export interface EntryUpdateInput extends CollectionsRouteBody { id: string }

/** What a successful update answers. */
export type EntryUpdateOutput = OkValue<Awaited<ReturnType<typeof updateEntry>>>;

/**
 * design-spec.md §1.5/§1.9 — `PUT /api/admin/v1/entries/:id` (updates an entry's
 * title/fieldsJson, REQ-28). Gated by `admin.collections.manage`.
 */
export const entryUpdateRoute = defineJsonRoute<EntryUpdateInput, EntryUpdateOutput, EntryUpdateRouteDeps, CollectionsRoutePrincipal>({
  method: "put",
  path: "/api/admin/v1/entries/:id",
  parse: (raw) => ok({ value: { id: String(raw.params.id), body: collectionsBody({ raw }) } }),
  handle: async ({ input, deps, context, authorize }) => {
    const principal = collectionsPrincipal({ context });
    await authorizeCollections({ authorize, permission: "admin.collections.manage", entityType: "entry" });

    const body = input.body;
    if (typeof body.expectedVersion !== "number") rejectValidation({ error: "'expectedVersion' (number) is required" });

    const result = await updateEntry({
      deps: entriesDeps(deps),
      input: {
        actorId: principal.id,
        workspaceId: deps.workspaceId,
        id: input.id,
        title: typeof body.title === "string" ? body.title : undefined,
        fieldsJson: body.fieldsJson,
        // Forwarded rather than dropped. `Jini packages/cms/src/entries/write-service.ts`'s
        // `updateEntry` has always supported `bodyJson` (and leaves the stored
        // value alone when it is `undefined`), but this route never read it —
        // so a rich-text edit to an existing entry returned 200 while the body
        // silently kept its pre-edit value. Two independent audits reproduced
        // that end to end, including with `bodyJson` explicitly in the request.
        //
        // `undefined` when absent is load-bearing: it is what makes a
        // title-only or fields-only PUT keep the existing body instead of
        // clearing it.
        bodyJson: "bodyJson" in body ? body.bodyJson : undefined,
        expectedVersion: body.expectedVersion,
      },
    });
    if (!result.ok) rejectWriteFailure({ error: result.error, statusOf: entryWriteErrorStatus });

    // 2026-09-03 outbox-drain audit fix — drains the outbox so `updateEntry`'s `entry.updated`
    // event reaches `bus.subscribe`d consumers before the response rather than on the background
    // drainer's next pass (mirrors the posts update route's identical inline drain).
    await deps.drainOutbox();
    return ok({ value: result.value });
  },
});
