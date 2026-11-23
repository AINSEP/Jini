/**
 * @file What `use-pages.hooks.ts` needs from the outside world, as an interface rather than a
 * direct `lib/api` import. Follows the `useX(dependencies)` / `useWiredX()` pair documented in
 * `development/docs/architecture/wired-hooks-convention.md`.
 * Now: this package owns the hook half and this port; the host binds the real API client and keeps
 * the wired half. Rows are typed structurally ({@link PageListRow}) rather than as the host's full
 * post record: the list reads only these fields, so any host row that carries them (plus whatever
 * else) fits, and the port is generic over the host's own row/patch types so a host editor port can
 * `Pick` its methods without losing its richer record type.
 */

/** The fields of one page row the Pages list reads, round-trips, or renders — nothing more. */
export interface PageListRow {
  id: string;
  title: string;
  slug: string;
  /** Round-tripped untouched by the publish toggle (see `togglePagePublish`'s doc). */
  bodyJson: Record<string, unknown>;
  status: "draft" | "published";
  updatedAt: string;
  /** Optimistic-concurrency basis sent back as `expectedVersion`. */
  version: number;
}

/** The patch the list's own publish toggle sends: the row's own title/slug/body plus the flipped status. */
export type PageListPatch = Partial<Pick<PageListRow, "title" | "slug" | "bodyJson" | "status">> & {
  expectedVersion?: number;
};

export interface PagesPort<Row extends PageListRow = PageListRow, Patch extends PageListPatch = PageListPatch> {
  listPages(): Promise<{ posts: Array<{ post: Row }> }>;
  createPage(required: { title: string }): Promise<{ post: Row }>;
  /**
   * `expectedVersion` (2026-09-18, multi-author hardening) — mirrors `posts-list-port.hooks.ts`'s
   * identical member exactly (Pages and Posts share this one route). `togglePagePublish`
   * (`use-pages.hooks.ts`) always sends it.
   *
   * `expectedVersion` (2026-09-07) is the optimistic-concurrency basis, NOT a field of the page:
   * the `AdminPost.version` this editor loaded, which the server compares and rejects with
   * `409 VERSION_CONFLICT` when a newer save has superseded it. Same optional, purely additive
   * extension `PostEditorPort` already declares — one shared kind-blind route (`PUT /posts/:id`)
   * serves both editors. Omitting it is exactly the last-write-wins behavior this method has always
   * had; `usePageEditor` always sends it once the row has loaded.
   * Now: the twin port, the `AdminPost` record and the page editor are the host's; here the basis
   * is the row's `version`.
   */
  updatePost(
    required: {
      target: { id: string };
      patch: Patch;
    }
  ): Promise<{ post: Row }>;
  deletePage(required: { id: string }): Promise<{ post: Row }>;
}

/**
 * The host's content-refresh notification, already filtered to this screen's resource. The list
 * invalidates its read whenever it fires — an assistant run can write a page (an agent-callable
 * `pages_write_html`-style tool) that this screen otherwise has no way to learn about. Same
 * `{ subscribe(listener): unsubscribe }` shape the redirects owner's `RedirectsEventsPort` uses.
 */
export interface PagesEventsPort {
  subscribe(listener: () => void): () => void;
}
