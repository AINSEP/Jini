import { withoutUndefined } from "@jini-ai/core/records";
import { updatePost } from "./post-update.js";
import { restorePostForward } from "./post-trash.js";

import { AGENT_TOOL_PRINCIPAL_KIND, requireInputRecord, requireString, withSchemaOnRejection, type ToolHandler } from "@jini-ai/core";
import { type JsonObject } from "@jini-ai/core/primitives";

import { type PostStatus } from "@jini-ai/cms/core";

import { type PostRecord } from "@jini-ai/cms/posts/post";
import { parseExpectedVersion } from "@jini-ai/cms/posts/expected-version";

import { assistantPostAttribution, postCommandDeps } from "./post-tool-policy.js";
import { isPostShapeRejection } from "@jini-ai/cms/posts/post-tool-errors";
import { requirePostKind, resolveFeaturedImageInput } from "./post-tool-input.js";
import { toPostWriteResultView } from "@jini-ai/cms/posts/post-tool-views";

import { parseUpdatePatch, assertPatchNotEmpty, loadUpdateTarget, assertTemplateAvailable, mergeUpdatePatch, isPartialPatch, assertHtmlBodyUnchanged, updateInverse } from "./post-tool-update.js";
import type { PostToolDeps } from "./post-tool-deps.js";

function executePostToolUpdate({ routeDeps, ctx, id, merged, publishAt, featuredMediaId, author, showAuthor, basisVersion, templateChoice }: {
  routeDeps: PostToolDeps; ctx: Parameters<ToolHandler>[0]; id: string; merged: { title: string; slug: string; bodyJson: JsonObject; status: PostStatus };
  publishAt: ReturnType<typeof parseUpdatePatch>["publishAt"]; featuredMediaId: Awaited<ReturnType<typeof resolveFeaturedImageInput>>;
  author: ReturnType<typeof parseUpdatePatch>["author"]; showAuthor: ReturnType<typeof parseUpdatePatch>["showAuthor"]; basisVersion: ReturnType<typeof parseExpectedVersion>; templateChoice: ReturnType<typeof parseUpdatePatch>["templateChoice"];
}) {
  // `captureInverse` above always runs first (per `core/commands`'s own contract) and
  // either throws or sets `merged` — see the declarations above.
  return updatePost({
    deps: {
      repo: routeDeps.postRepo,
      clock: routeDeps.clock,
      outbox: routeDeps.outbox,
      beforeSaveHook: routeDeps.pluginBeforeSaveHook,
      slugChangeCapture: routeDeps.slugChangeCapture,
      reservedSegments: routeDeps.reservedSegments,
      postPublicPath: routeDeps.postPublicPath,
      isDeepStrictEqual: routeDeps.isDeepStrictEqual,
    },
    // `title`/`slug`/`bodyJson`/`status` are the MERGED values (the caller's own field,
    // or the stored one for an omitted field) — never the raw, possibly-partial input.
    // `basisVersion` is `expectedVersion` forwarded exactly the way `posts/update.ts`
    // forwards it, EXCEPT for a partial patch with no caller-sent `expectedVersion`,
    // where `captureInverse` above upgraded it to `existing.version` so the merge stays
    // atomic. `undefined` (a full four-field call, caller sent nothing) is still what
    // keeps the guard opt-in, so that caller keeps the original last-write-wins save.
    input: {
      workspaceId: routeDeps.workspaceId,
      id,
      title: merged.title,
      slug: merged.slug,
      bodyJson: merged.bodyJson,
      status: merged.status,
      ...withoutUndefined({ source: { publishAt, featuredMediaId, author, showAuthor, expectedVersion: basisVersion, templateChoice } }),
      ...assistantPostAttribution({ principalId: ctx.principal.id }),
      analyticsSource: "assistant",
      // See content_post_create's identical delegatedBy* comment just above.
      delegatedByWorkspaceId: routeDeps.workspaceId,
      delegatedById: ctx.principal.id,
    },
  });
}

async function restorePostToolUpdate({ routeDeps, ctx, priorPost }: { routeDeps: PostToolDeps; ctx: Parameters<ToolHandler>[0]; priorPost: PostRecord }) {
  await restorePostForward({
    deps: {
      repo: routeDeps.postRepo,
      clock: routeDeps.clock,
      outbox: routeDeps.outbox,
      forgetRemoved: routeDeps.forgetRemovedPost,
    },
    input: {
      prior: priorPost,
      ...assistantPostAttribution({ principalId: ctx.principal.id }),
      // Same delegatedBy* attribution the forward write above records.
      delegatedByWorkspaceId: routeDeps.workspaceId,
      delegatedById: ctx.principal.id,
    },
  });
}

export async function updatePostToolPost({ routeDeps, ctx }: { routeDeps: PostToolDeps; ctx: Parameters<ToolHandler>[0] }) {
  const input = requireInputRecord({ input: ctx.input });
  return withSchemaOnRejection({ toolId: "content_post_update", catalog: routeDeps.catalog, isShapeRejection: ({ error }) => isPostShapeRejection({ error }), fn: async () => {
    const id = requireString({ input: input, key: "id" });
    const kind = input.kind === undefined ? undefined : requirePostKind(input);
    // S7 (fix-plan-tool-design-2026-09-24.md) — a PARTIAL patch: each of these four is now
    // independently optional. An omitted one is filled from the stored row inside
    // `captureInverse` below (the one place this handler already reads `existing`), not here —
    // a present-but-invalid value still rejects with the exact same message it always did.
    const patch = parseUpdatePatch(input);
    const { author, showAuthor, templateChoice, publishAt } = patch;
    const featuredMediaId = await resolveFeaturedImageInput(routeDeps, input);
    assertPatchNotEmpty({ patch, featuredMediaId });
    // Validated, not cast — see `expected-version.ts`. `expectedVersion` is optional on
    // `UpdatePostInput`, so anything this handler failed to recognize would coerce to "no basis
    // sent" and be written through as an unguarded save, re-opening the very clobber the guard
    // closes. `PostValidationError` reaches `withSchemaOnRejection` above, which turns it into a
    // schema-decorated `ToolInputError` — a 400 the model can act on, not a silent downgrade.
    const expectedVersion = parseExpectedVersion({ raw: input.expectedVersion });

    const { result } = await executePostToolUpdateCommand({ routeDeps, ctx, id, kind, patch, publishAt, featuredMediaId, author, showAuthor, expectedVersion, templateChoice });

    // Mirrors posts/update.ts's/pages/update.ts's identical inline processOutbox call — drains
    // updatePost's entry.published/entry.updated/entry.unpublished event (if any) to SEO's
    // sitemap-cache invalidation subscriber at once. In the agent daemon the outbox is
    // enqueue-only, so this claims nothing and the serving process's background drainer
    // delivers instead (`agent daemon outbox`).
    await routeDeps.processOutbox({ outbox: routeDeps.outbox, bus: routeDeps.bus, clock: routeDeps.clock });

    return { post: toPostWriteResultView({ deps: routeDeps.postToolViewDeps({ routeDeps }), post: result.post }) };
  } });
}
async function executePostToolUpdateCommand({ routeDeps, ctx, id, kind, patch, publishAt, featuredMediaId, author, showAuthor, expectedVersion, templateChoice }: {
  routeDeps: PostToolDeps; ctx: Parameters<ToolHandler>[0]; id: string; kind: ReturnType<typeof requirePostKind> | undefined; patch: ReturnType<typeof parseUpdatePatch>;
  publishAt: ReturnType<typeof parseUpdatePatch>["publishAt"]; featuredMediaId: Awaited<ReturnType<typeof resolveFeaturedImageInput>>; author: ReturnType<typeof parseUpdatePatch>["author"]; showAuthor: ReturnType<typeof parseUpdatePatch>["showAuthor"];
  expectedVersion: ReturnType<typeof parseExpectedVersion>; templateChoice: ReturnType<typeof parseUpdatePatch>["templateChoice"];
}, _optional = {}) {
  // Captured by `captureInverse` below, reused verbatim by `rollback` — mirrors
  // `posts/update.ts`/`pages/update.ts`'s identical unit-of-work compensation.
  // `priorPost` and `merged` are declared without an initializer, so neither reader needs a
  // null guard: `core/commands`'s `executeCommand` always awaits `captureInverse` first and
  // calls `execute` only once it returned, and calls `rollback` only after `execute`
  // succeeded — so both are always set by the time `execute`/`rollback` read them.
  let priorPost: PostRecord;
  // The merged, fully-populated values `execute` below actually sends to `updatePost` — set
  // inside `captureInverse`, the only place `existing` (the fill-in source for an omitted
  // field) is available. `basisVersion` starts as whatever the caller sent and is upgraded to
  // `existing.version` there too, but ONLY for a partial patch with no caller-sent
  // `expectedVersion` — see that comment for why a full four-field call must NOT gain a basis
  // it never asked for.
  let merged: { title: string; slug: string; bodyJson: JsonObject; status: PostStatus };
  let basisVersion = expectedVersion;

  ctx.signal.throwIfAborted();
  const { result } = await routeDeps.executeCommand<{ post: PostRecord }>({
    deps: postCommandDeps(routeDeps),
    command: {
      workspaceId: routeDeps.workspaceId,
      actor: { id: ctx.principal.id, kind: AGENT_TOOL_PRINCIPAL_KIND },
      summary: `Agent update ${kind ?? "content"} '${id}'`,
      permission: routeDeps.contentWritePermission,
    },
    mutation: {
      entityType: "post",
      entityId: id,
      operation: "update",
      captureInverse: async () => {
        const existing = await loadUpdateTarget({ routeDeps, id, kind });
        await assertTemplateAvailable({ routeDeps, templateChoice, kind: existing.kind });
        // S7 — fill every field the caller omitted from the stored row. This runs BEFORE the
        // html-body guard just below on purpose: an omitted `bodyJson` must merge in as
        // `existing.bodyJson` itself, so a title-only patch on an html Page compares equal
        // to itself and sails through that guard rather than being misread as a body change
        // it never made.
        merged = mergeUpdatePatch({ patch, existing });
        // A partial patch (any of the four omitted) is a read-then-write on a basis the
        // caller did NOT necessarily pin with its own `expectedVersion`. Filling the gap from
        // `existing` and then writing unconditionally would silently clobber a human's save
        // landing between this read and `updatePost`'s write — so pin it to the row's own
        // version instead, exactly as if the caller had sent it. `updatePost`'s own
        // `assertExpectedVersion`/`saveIfVersion` CAS (already wired) does the actual
        // enforcement; this only supplies the basis for a caller who left it out. A FULL
        // four-field call is unaffected: `basisVersion` stays whatever the caller sent (or
        // `undefined`), the same opt-in last-write-wins behavior as before this slice.
        if (isPartialPatch(patch) && expectedVersion === undefined) {
          basisVersion = existing.version;
        }
        // S3 — see assertHtmlBodyUnchanged's doc for why an html Page refuses a changed bodyJson.
        assertHtmlBodyUnchanged({ id, existing, bodyJson: merged.bodyJson, isDeepStrictEqual: routeDeps.isDeepStrictEqual });
        priorPost = existing;
        return updateInverse({ existing, templateChoice });
      },
      execute: () => executePostToolUpdate({ routeDeps, ctx, id, merged, publishAt, featuredMediaId, author, showAuthor, basisVersion, templateChoice }),
      captureEntityVersion: ({ result }) => result.post.version,
      rollback: async () => restorePostToolUpdate({ routeDeps, ctx, priorPost }),
    },
  });

  return { result };
}

