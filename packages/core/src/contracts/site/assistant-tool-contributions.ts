/** Resource contribution contracts only: features return data; composition owns registration.
 * Preserve the generic dependency contract rather than binding features to the full tool registry. */
/**
 * One resource's contract for participating in `content_duplicate`.
 *
 * `permission` is the SINGLE permission `content_duplicate`'s own handler checks before invoking
 * `duplicate` — resolved from the resource's OWN existing declared permission (e.g. `content.write`
 * for `post`/`page`, the same permission `content_post_create`/`content_post_update` already
 * declare), never a single flat permission shared by the whole generic tool. This is what makes
 * "a caller permitted for posts but not media cannot copy media through it" true by construction: a
 * caller lacking THIS resource's permission is refused before `duplicate` is ever called, regardless
 * of what any other resource's permission is.
 *
 * `duplicate` still owns whatever FINER-grained authorization/guard logic the resource's real
 * write-service already applies (e.g. `post`'s own upfront `content.read` check before it will even
 * disclose the source row exists) — this registry's `permission` is the generic tool's own outer
 * gate, not a replacement for a resource's existing internal ones.
 */
export interface DuplicateResourceHandler {
  readonly permission: string;
  readonly duplicate: (input: {
    readonly principalId: string;
    readonly id: string;
    readonly overrides: { readonly title?: string; readonly slug?: string; readonly status?: string };
  }, optional?: Record<string, never>) => Promise<Record<string, unknown>>;
}

/**
 * One resource's registry entry: which resource id it answers to, and how to build its real,
 * deps-bound {@link DuplicateResourceHandler} once the composition root's real deps bag exists.
 *
 * `build` is deferred (not a bound handler) for the identical reason `ToolContributor.build` is:
 * `installFirstPartyToolContributors()` (where registration happens) runs once at boot, before any
 * real `routeDeps`/`AssistantToolRegistryDeps` exists; `content_duplicate`'s own `build(routeDeps,
 * surfaces)` (run per real composition, later) is what actually resolves every registered
 * contributor into a real handler.
 */
export interface DuplicateResourceHandlerContributor<TDeps> {
  readonly resource: string;
  readonly build: (routeDeps: TDeps, optional?: Record<string, never>) => DuplicateResourceHandler;
}

