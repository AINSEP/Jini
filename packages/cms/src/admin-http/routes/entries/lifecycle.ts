import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { ENTRY_LIFECYCLE_OPS, entriesDeps, entryWriteErrorStatus, parseEntryLifecycleOp, type EntriesToolDeps, type EntryLifecycleOp } from "../../../entries/index.js";
import { authorizeCollections, collectionsBody, collectionsPrincipal, rejectValidation, rejectWriteFailure, type CollectionsOutwardErrorDeps, type CollectionsRouteBody, type CollectionsRoutePrincipal, type OkValue, type OutboxDrainDeps } from "../content-types/collections-route.js";

/** The deps this route reads. */
export interface EntryLifecycleRouteDeps extends EntriesToolDeps, OutboxDrainDeps, CollectionsOutwardErrorDeps {}

/** The entry id plus the untyped POST body. */
export interface EntryLifecycleInput extends CollectionsRouteBody { id: string }

/** What a successful transition answers. */
export type EntryLifecycleOutput = OkValue<Awaited<ReturnType<(typeof ENTRY_LIFECYCLE_OPS)[EntryLifecycleOp]>>>;

/**
 * design-spec.md §1.5/§1.9 — `POST /api/admin/v1/entries/:id/lifecycle` (Publish/Unpublish,
 * REQ-28). Gated by `admin.collections.manage`.
 *
 * ADR-042 closed-union-dispatch: `op` is narrowed to `EntryLifecycleOp` before lookup —
 * mirrors `../content-types/lifecycle.ts`'s identical shape.
 */
export const entryLifecycleRoute = defineJsonRoute<EntryLifecycleInput, EntryLifecycleOutput, EntryLifecycleRouteDeps, CollectionsRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/entries/:id/lifecycle",
  parse: (raw) => ok({ value: { id: String(raw.params.id), body: collectionsBody({ raw }) } }),
  handle: async ({ input, deps, context, authorize }) => {
    const principal = collectionsPrincipal({ context });
    await authorizeCollections({ authorize, permission: "admin.collections.manage", entityType: "entry" });

    const body = input.body;
    const op = parseEntryLifecycleOp({ op: body.op });
    if (!op) rejectValidation({ error: "'op' must be one of 'publish', 'unpublish'" });
    if (typeof body.expectedVersion !== "number") rejectValidation({ error: "'expectedVersion' (number) is required" });

    const handler = ENTRY_LIFECYCLE_OPS[op];
    const result = await handler({
      deps: entriesDeps(deps),
      input: { actorId: principal.id, actor: { id: principal.id, kind: "user" }, workspaceId: deps.workspaceId, id: input.id, expectedVersion: body.expectedVersion },
    });
    if (!result.ok) rejectWriteFailure({ error: result.error, statusOf: entryWriteErrorStatus, outwardErrorMessage: deps.outwardErrorMessage });

    // 2026-09-03 outbox-drain audit fix — drains the outbox so `publishEntry`/`unpublishEntry`'s
    // `entry.published`/`entry.unpublished` event reaches `bus.subscribe`d consumers before the
    // response rather than on the background drainer's next pass (mirrors the posts update
    // route's identical inline drain).
    await deps.drainOutbox();
    return ok({ value: result.value });
  },
});
