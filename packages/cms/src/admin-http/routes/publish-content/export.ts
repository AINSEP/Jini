import type { JsonRouteAuthorize, RouteInputContext } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { CONTENT_HASH_VERSION } from "../../../publish/content/content-hash.js";
import { PUBLISH_CONTENT_ARTIFACT_FORMAT_VERSION } from "../../../publish/transfer/index.js";
import { authorizePublishContentPermission } from "./blob-shared.js";
import type { PublishRoutePrincipal } from "./transport-shared.js";

/**
 * @file Task 4 of the publish-content (Publish Content) feature —
 * `ADS-memory/reports/2026-09-18-publish-feature-implementation-plan.md` §1.1/§4 task 4.
 *
 * `GET /api/admin/v1/workspaces/:workspaceId/publish-content/export` — read-only (never writes a
 * row), streams `{hashVersion, sourceLabel, entities[], blobManifest[]}`.
 *
 * ## The security property this route exists to hold (plan §3 rule 5, §5 risk #8)
 *
 * The type filter is an ALLOWLIST of registered publish-content types, never a deny-list: this
 * route never reads any table directly, and never enumerates "every table except the ones on some
 * excluded-list" — its ONLY source of entities is `listPublishContentContributors()` (Task 2),
 * called fresh at request time (never cached — see `type-registry.ts`'s own "fresh-read" rule). A
 * table added tomorrow with no contributor registered for it is therefore invisible to this route
 * BY CONSTRUCTION, not because someone remembered to add it to a deny-list. This is exactly the
 * property `apps/website/src/server/__tests__/routes/publish-content-export.test.ts`'s "empty registry -> empty bundle, despite real DB content"
 * test pins directly, and `apps/website/src/server/__tests__/integration/publish-content-export-no-leak.integration.test.ts` pins end-to-end against a
 * real SQLite db seeded with a canary row in every named sensitive table.
 *
 * ## Two DIFFERENT permission checks, not one
 *
 * 1. `publish_content.read` gates the route itself — a principal without it never reaches the
 *    registry loop at all (403, not a partial/empty 200 that could be mistaken for "nothing to
 *    export").
 * 2. Each registered type's OWN `permission` (plan §3: "the resource's OWN existing write
 *    permission", e.g. `content.write` for `post`/`page` — `PublishContentHandler.permission`)
 *    gates that ONE type's inclusion. A principal holding `publish_content.read` but not, say,
 *    `content.write` still gets a 200 — just with that type's entities silently omitted, never a
 *    500. This is what makes "a principal allowed posts but not media is refused media by
 *    construction" (plan §3) true for the export side, not just the apply side.
 *
 * ## Why this streams rather than buffers
 *
 * `PublishContentHandler.pack()` is an async generator specifically so a large collection never
 * has to be held in memory whole (`type-registry.ts`'s own doc: "Task 4's export route streams its
 * response body from this directly"). This handler writes the JSON envelope by hand (one chunk per
 * entity) rather than building an array and serializing it once, so memory use stays bounded by
 * one entity at a time regardless of corpus size. It is therefore a raw route: the host's raw mount
 * pipes the returned stream.
 */

/** The one field of a packed entity this route reads beyond serializing it whole. */
export interface ExportPackedEntity { readonly requiredBlobs: readonly string[] }

/** The deps this route reads. */
export interface ExportRouteDeps {
  workspaceId: string;
  workspaceRepo: { findById(required: { id: string }): Promise<{ readonly name: string } | null> };
  /** Whether this request authenticated with a publishing credential (the host's grant lookup). */
  isPublishingCredential: (required: { context: PublishRoutePrincipal | undefined }) => boolean;
  /** The host's registry walk with its per-type permission gate (`packAuthorizedEntities`). */
  packEntities: (required: { principalId: string }) => AsyncIterable<ExportPackedEntity>;
}

/** The structural raw-route shape the host's raw admin mount takes (this package never imports the server toolkit). */
export interface PublishContentRawRoute<Deps> {
  readonly method: "get";
  readonly path: string;
  handle(
    required: { readonly raw: RouteInputContext; readonly deps: Deps; readonly context: PublishRoutePrincipal | undefined; readonly authorize: JsonRouteAuthorize },
    optional: { readonly signal: AbortSignal },
  ): Promise<Response>;
}

/**
 * The export envelope as a byte stream, one entity per pull (this file's header, "Why this streams
 * rather than buffers").
 * @complexity O(n) in the packed entities; memory O(1) entities plus the blob-manifest set.
 */
function exportBundleStream({ sourceLabel, entities }: { sourceLabel: string; entities: AsyncIterable<ExportPackedEntity> }, _options: Record<string, never> = {}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const iterator = entities[Symbol.asyncIterator]();
  const requiredBlobs = new Set<string>();
  let separator = "";
  return new ReadableStream<Uint8Array>({
    start: (controller) => {
      controller.enqueue(encoder.encode(
        `{"artifactFormatVersion":${JSON.stringify(PUBLISH_CONTENT_ARTIFACT_FORMAT_VERSION)},` +
          `"hashVersion":${JSON.stringify(CONTENT_HASH_VERSION)},"sourceLabel":${JSON.stringify(sourceLabel)},"entities":[`,
      ));
    },
    pull: async (controller) => {
      try {
        const next = await iterator.next();
        if (next.done) {
          controller.enqueue(encoder.encode(`],"blobManifest":${JSON.stringify(Array.from(requiredBlobs))}}`));
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(separator + JSON.stringify(next.value)));
        separator = ",";
        for (const sha of next.value.requiredBlobs) requiredBlobs.add(sha);
      } catch {
        // The envelope's opening brace is already flushed by the time a contributor's pack()
        // throws mid-stream, so no fresh error body can be sent any more: this just ends the
        // response rather than emitting a byte stream a client could half-parse as valid JSON.
        controller.close();
      }
    },
    cancel: async () => { await iterator.return?.(); },
  });
}

/** Stream the export bundle. @complexity O(n) in the packed entities. */
export const exportRoute: PublishContentRawRoute<ExportRouteDeps> = {
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/publish-content/export",
  handle: async ({ deps, context, authorize }) => {
    // A publishing credential is refused here, loudly, even though it holds
    // `publish_content.read`. The route-level gate is not the only check this handler applies:
    // `packEntities` below ALSO asks for each registered type's own write permission
    // (this file's header, "Two DIFFERENT permission checks"), and a per-type denial omits that
    // type and continues rather than failing. A publishing grant's capability set is closed and
    // cannot contain `content.write` (the host's `features/publish-trust/grant.ts`), so every type would be
    // omitted and the caller would receive a well-formed bundle containing NOTHING — a silently
    // wrong answer, which is worse than a refusal. Pull-by-publishing-credential needs the
    // per-type gate to be answerable from the grant's `entityTypes`; until it is, this says so.
    if (deps.isPublishingCredential({ context })) {
      rejectRoute({
        status: 403,
        error: "a publishing credential cannot export from this site",
        code: "FORBIDDEN",
        details: { permission: "publish_content.read", reason: "publish_trust_export_not_wired" },
      });
    }
    await authorizePublishContentPermission({ authorize, permission: "publish_content.read" });
    if (!context) throw new Error("publish-content export has no authenticated principal");
    const workspace = await deps.workspaceRepo.findById({ id: deps.workspaceId });
    const sourceLabel = workspace?.name ?? deps.workspaceId;
    // The registry walk and the per-type gate (see this file's own header, "Two DIFFERENT
    // permission checks") live in the host's `export-bundle.ts` so Task 10's push driver runs the IDENTICAL
    // loop rather than a second copy of it. A per-type denial omits that type and continues; it
    // never turns into a 500 or aborts the stream. This route keeps its own streaming write, which
    // is the one thing the two callers genuinely do differently.
    const entities = deps.packEntities({ principalId: context.id });
    return new Response(exportBundleStream({ sourceLabel, entities }), { status: 200, headers: { "content-type": "application/json" } });
  },
};
