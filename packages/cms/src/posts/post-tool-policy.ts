import type { MutationActor } from "@jini-ai/core/contracts/events";
import { type AgentToolSideEffect, type DerivedRiskByToolId } from "@jini-ai/core";
import type { PostToolDeps } from "./post-tool-deps.js";

/**
 * @file Posts + Pages' half of ADR-049 Decision 4: maps `agent-tools.ts`'s 6 catalog entries onto
 * `post.ts`'s `createPost`/`updatePost`/`deletePost`/`listAdminPosts`/`listAdminPages`/
 * `getAdminPostById` plus `search.ts`'s `searchAdminPosts`, as `ToolRegistration`s.
 *
 * Authorization shape: `createPost`/`updatePost` (`post.ts`) carry no `authorize()` call of their
 * own (confirmed by reading the whole file) — unlike Forms' write-service functions, which
 * self-enforce and let `ToolPolicy` stay a pure pass-through. So `content_post_create`/
 * `content_post_update` route through `core/commands`'s `executeCommand` directly, exactly the same
 * composition `posts/create.ts`/`posts/update.ts`/`pages/create.ts`/`pages/update.ts` already use
 * (same `content.write` permission, same command gateway) — mirroring `features/plugin-runtime/
 * tool-registrations.ts`'s identical precedent for a domain with no self-enforcing write-service
 * layer of its own. `content_post_list`/`content_post_get` have no service-layer gate either
 * (`listAdminPosts`/`listAdminPages`/`getAdminPostById` take no `authorize()` param at all), so
 * their handlers perform the same inline `content.read` check the admin GET routes perform
 * themselves — mirroring `features/entries/tool-registrations.ts`'s identical `collections_entry_list`
 * precedent. `content_post_search` is in that same group (`searchAdminPosts` takes no `authorize`
 * param either), with the one difference that it has no admin route to mirror at all — see
 * `agent-tools.ts`'s header for why that is deliberate rather than a gap in the mirroring rule.
 *
 * `publicUrl` (2026-08-30, closing a real capability gap surfaced by a production transcript —
 * `sites/host-com/content.db`, `ai_chat_messages` rowid 427): the agent had no tool that told it
 * where a post/page it just read or created is actually reachable on the live site, and fell back
 * to grepping route source to reverse-engineer the URL pattern. `content_post_get`/`content_post_list`/
 * `content_post_create` now resolve it through {@link resolvePublicUrl}, which calls
 * `platform/routing`'s {@link entryPublicPath} — the pure per-record half of the SAME `urlFor`
 * inverse resolver `routes/site/pages.ts`'s `buildExtraHead` already treats as the one source of
 * truth for a post's live path (SEO's canonical tag, menu active state); `urlFor`'s own
 * `resolveEntryRefTarget` calls this identical function after its `postRepo.findById`, so a caller
 * resolving from an id and a caller resolving from an already-held `PostRecord` (this file's own
 * case — the row is already sitting in the loop variable) always agree. Deliberately NOT added to
 * `content_post_update`/`content_post_delete`'s existing `toPostToolView(...)` call sites: those
 * return the row incidentally (to confirm what was just written/deleted/cancelled), not to answer
 * "where does this live", so there is no reason to pay for the extra resolution there — hence the
 * separate {@link PostToolViewWithPublicUrl}/{@link toPostToolViewWithPublicUrl} rather than
 * widening the shared `PostToolView`/`toPostToolView`.
 *
 * `content_post_list` scale (2026-08-30, H3): `resolvePublicUrl` used to call `urlFor` per row,
 * which re-fetched the exact record the list loop already held (an O(n) `postRepo.findById` fan-out
 * on top of the O(1) `postRepo.list()` that already produced every row) — see {@link entryPublicPath}
 * above for the fix. `content_post_list` also now caps its output at {@link DEFAULT_POST_LIST_LIMIT}
 * (raisable up to {@link MAX_POST_LIST_LIMIT} via the `limit` input) with `total`/`hasMore` in the
 * response, so a large workspace can no longer flood the agent's context with every row, and
 * truncation is never silent.
 */

/**
 * This wiring layer's OWN risk classification, authored from what each handler below actually
 * calls. See `DerivedRiskByToolId` in the kit for why it is independent of the catalog's own
 * `sideEffects` declaration.
 */
export const postDerivedRisk: DerivedRiskByToolId = new Map<string, AgentToolSideEffect>([
  // -> searchAdminPosts (search.ts) -> PostSearchPort.search(): a SELECT against the FTS5 index
  //    joined back to `posts`. Read-only in both adapters — the durable one runs one prepared
  //    query, and the in-memory one's per-query mirror writes only to its own private `:memory:`
  //    scratch database, never to anything a caller can observe or that survives the process.
  ["content_post_search", "none"],
  // -> listAdminPosts/listAdminPages (post.ts): postRepo.list() only, no write.
  ["content_post_list", "none"],
  // -> getAdminPostById (post.ts): postRepo.findById() only, no write.
  ["content_post_get", "none"],
  // -> executeCommand -> createPost (post.ts): postRepo.save() + change-set record, plus an
  //    outbox-drained entry.published event when created directly as `status: "published"`.
  ["content_post_create", "mutates-durable-state"],
  // -> executeCommand -> updatePost (post.ts): postRepo.save() + change-set record, plus an
  //    outbox-drained entry.published/entry.updated/entry.unpublished event on a status transition.
  ["content_post_update", "mutates-durable-state"],
  // -> executeCommand -> deletePost (post.ts): postRepo.softDelete() + change-set record, plus an
  //    outbox-drained entry.unpublished event when the trashed row was published. Classified
  //    `deletes-durable-state` and NOT `mutates-durable-state`: what the handler calls makes the
  //    row vanish from listAdminPosts/listAdminPages/getAdminPostById/listPublishedPosts/
  //    getPublishedPostBySlug and from the public site — a different kind of consequence from an
  //    edit, and the whole reason this file's classification is derived from the call graph rather
  //    than read off the catalog. Note this entry describes the call's CONFIRMED outcome (the human
  //    clicked Delete); the SAME call's cancelled/expired/abandoned outcomes write nothing, so the
  //    classification here is the strictly worse of the outcomes, which is the conservative
  //    direction (ADR-055 Decision 2 — one held-open call, not a mint call plus a redeem call).
  ["content_post_delete", "deletes-durable-state"],
]);
// NOTE: no "content_post_duplicate" entry — duplication is no longer this domain's own bespoke
// tool. See `duplicatePostOrPage`/`contributePostDuplicateHandlers` below: this domain contributes
// its "post"/"page" copy capability to the cross-resource `content_duplicate` tool
// (`features/content-duplication/`) instead, via `assistant/duplicate-resource-registry.ts`.

/** See `trash/trash-item-tool.ts`'s identical constant's doc — duplicated here rather than
 *  imported, the same "structurally typed, no `features/trash` import" convention
 *  {@link RemovePostFn}'s own doc already follows. */


/**
 * The attribution every assistant post write passes to its writer (P10-H2, FIX 19): the acting
 * principal AND the `agent` kind together, so no assistant write can name a principal without also
 * recording the channel it came through. The writers' own `actor` field stays optional for their
 * other callers; this family goes through here and cannot drop it.
 *
 * @param required - `principalId`: the tool context's acting principal.
 * @returns `{ actorId, actor }` with `actor.kind === "agent"`.
 * @complexity O(1).
 */
export function assistantPostAttribution(required: { principalId: string }, _optional: Record<string, never> = {}): { actorId: string; actor: MutationActor & { kind: "agent" } } {
  return { actorId: required.principalId, actor: { id: required.principalId, kind: "agent" } };
}

/** Shared dependency bag for `core/commands`'s `executeCommand` — identical shape to the one
 * `posts/create.ts`/`posts/update.ts`/`pages/create.ts`/`pages/update.ts` each build inline. */
export function postCommandDeps(routeDeps: PostToolDeps) {
  return {
    clock: routeDeps.clock,
    idGen: routeDeps.idGen,
    changeSets: routeDeps.changeSets,
    outbox: routeDeps.outbox,
    authorize: routeDeps.authorize,
  };
}
