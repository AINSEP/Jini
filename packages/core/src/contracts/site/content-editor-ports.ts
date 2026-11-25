import type { AdminMedia } from "./cms-admin-media.js";
import type { HeadlessThemeTier } from "../headless/contracts.js";

export interface EditorDraftPort<Draft, Snapshot> {
  /** Captured before expiry so late failures cannot borrow the next operator's identity. */
  getBackupPrincipalId?: (requiredArgs: Record<string, never>, optionalArgs?: Record<string, never>) => string | null;
  putAutosave(required: { id: string; draft: Draft }, options?: { keepalive?: boolean }): Promise<{ applied: boolean }>;
  getAutosave(required: { id: string }, optional?: Record<string, never>): Promise<{ autosave: Snapshot | null }>;
  discardAutosave(required: { id: string }, optional?: Record<string, never>): Promise<{ ok: boolean }>;
}

/**
 * @file What `usePageEditor` needs from the outside world, as an interface rather than a direct
 * `lib/api` import.
 *
 * Follows the `useX(dependencies)` / `useWiredX()` pair documented on `assistant-chats-port.hooks.ts`
 * (the canonical reference in this workspace) and already applied to `features/redirects`: this file
 * declares, `page-editor-dependencies.hooks.ts` binds the real `api` client, and nothing else under
 * `features/pages/hooks` imports `lib/api` for these six routes.
 *
 * `getPresentation`'s return type is narrowed to the four fields this hook actually reads off it
 * (see `usePageEditor`'s load effect). `features/posts`' `usePostEditor` reads more fields off the
 * same route through its own `PostEditorPort` (`post-editor-port.hooks.ts`) — narrowing here is not a
 * shared contract, it is this hook's own consumption. The narrowing also moves two derivations off
 * the hook: the active theme's `apiVersion` and `tier` both live on `availableThemes`, keyed by id,
 * and `page-editor-dependencies.hooks.ts` resolves them rather than handing the whole array through.
 * `activeThemeTier` (2026-09-24, "View Template" parity with `features/posts`) feeds
 * `TemplateSourceModal`'s (`components/TemplateSource/TemplateSourceModal.tsx`) tier gate the same
 * way `usePostEditor`'s own `activeThemeTier` does.
 */
/**
 * Standing-draft autosave (2026-09-06 dispatch) — `putAutosave`/`getAutosave`/`discardAutosave` are
 * pulled in from the shared, feature-agnostic hook rather than redeclared here, so this port and
 * `PostEditorPort`'s identical extension stay structurally IDENTICAL by construction (one type,
 * not two hand-copied signatures that could quietly drift). See `use-standing-draft-autosave.hooks.ts`'s
 * own header for why the hook itself stays ignorant of both features either way.
 */
export interface PageEditorPort<Row, Embed, Draft, Snapshot> extends EditorDraftPort<Draft, Snapshot> {
  updatePost(required: { target: { id: string }; patch: { title?: string; slug?: string; bodyJson?: Record<string, unknown>; status?: "draft" | "published"; templateChoice?: string | null; overridesThemePage?: boolean; expectedVersion?: number } }): Promise<{ post: Row }>;
  deletePage(required: { id: string }): Promise<{ post: Row }>;
  getPage(required: { routeSlug: string }): Promise<{ post: Row; pluginEmbeds?: readonly Embed[] }>;
  getPresentation(): Promise<{
    activeThemeTemplates: string[];
    /** `PresentationSettings.activeThemeId` — feeds the Interactive tab's canvas stylesheet and
     *  token fetches (`use-theme-canvas-styling.hooks.ts`), and `TemplateSourceModal`'s fetch URL. */
    activeThemeId: string;
    /** The active theme's manifest `apiVersion` (`2`, or `undefined` for v1), looked up on
     *  `availableThemes` by `activeThemeId`. `undefined` also covers "the active theme is absent
     *  from `availableThemes`", which `@jini-ai/cms/themes/layout`'s `resolveThemeLayout` treats as v1 — the same conflation
     *  `usePostEditor`'s own `activeThemeApiVersion` documents. */
    activeThemeApiVersion: 2 | undefined;
    /** The active theme's capability tier, looked up on `availableThemes` the same way as
     *  `activeThemeApiVersion` just above. `null` when the id has not loaded yet OR when
     *  `activeThemeId` is absent from `availableThemes` — same conflation `usePostEditor`'s own
     *  `activeThemeTier` documents. Gates whether `TemplateSourceModal` attempts a fetch at all. */
    activeThemeTier: HeadlessThemeTier | null;
  }>;
  updatePageHtml(required: { id: string; html: string; expectedVersion: number }): Promise<{ post: Row }>;
  /**
   * Synchronous URL builder for the admin-only template-preview iframe — NOT a network call itself;
   * the browser navigates to the returned URL when the iframe's `src` is set. Belongs on the port
   * (not a plain `lib/api` import in `PageEditor.tsx`) for the same reason every other route here
   * does: `page-editor-dependencies.hooks.ts` becomes the only file that reaches `lib/api` for it,
   * and a test can assert the resolved URL came from the injected port. `templateChoice: null` omits
   * the query param (server renders the page's own saved template); `""` sends an explicit empty
   * value ("no template"); a real filename requests that template — see `lib/api.ts`'s own
   * `templatePreviewUrl` for the exact query-string contract this mirrors.
   */
  templatePreviewUrl(required: { id: string; templateChoice: string | null }): string;
}

/**
 * @file What `use-post-editor.hooks.ts` needs from the outside world, as an interface rather than a
 * direct `lib/api` import.
 *
 * Follows the `useX(dependencies)` / `useWiredX()` pair documented on `assistant-chats-port.hooks.ts`
 * (the canonical reference in this workspace) and copied from `Jini redirects/SOURCE-RATIONALE.md`'s own split: this file declares, `post-editor-dependencies.hooks.ts` binds
 * the real `api` client, and nothing else under this hook imports `lib/api` for these four routes.
 *
 * `navigate` (`lib/router`) is injected alongside this port on `usePostEditor`'s own second
 * parameter, not folded into it — it is host navigation, not this feature's own I/O, matching how
 * the off-limits conversion plan for `use-page-editor.hooks.ts` (`ADS-memory/reports/implementation/
 * 2026-08-11-wired-hooks-audit.md`) shapes its own `PageEditorDependencies`.
 *
 * `withTitleNode`/`titleNodeText` (`../rules.ts`) and TipTap's own `useEditor` are deliberately NOT
 * part of this port — the former are pure, I/O-free rules (per the pattern, a hook imports rules
 * directly rather than having them injected, same reasoning `assistant-chats-port.hooks.ts` gives for
 * `persistableMessages`), and the latter is editor/local-state infrastructure, not a host service.
 */
/**
 * Standing-draft autosave (2026-09-06 dispatch) — `putAutosave`/`getAutosave`/`discardAutosave` are
 * pulled in from the shared, feature-agnostic hook rather than redeclared here, so this port and
 * `PageEditorPort`'s identical extension stay structurally IDENTICAL by construction. See
 * `use-standing-draft-autosave.hooks.ts`'s own header for why the hook itself stays ignorant of
 * both features either way.
 */
export interface PostEditorPort<Row extends {
  title: string;
  slug: string;
  bodyJson: Record<string, unknown>;
  status: "draft" | "published";
  templateChoice?: string | null;
  overridesThemePage?: boolean | null;
  publishAt?: string | null;
  featuredMediaId?: string | null;
  author?: string | null;
  showAuthor?: boolean;
}, CreateInput, Presentation extends {
  settings: unknown;
  availableThemes: unknown;
  activeThemeTemplates: string[];
  activeThemeStaticPageIds: string[];
}, Draft, Snapshot> extends EditorDraftPort<Draft, Snapshot> {
  /** Creates only on first Save, with every edited field in one request. */
  createPost(input: CreateInput, options?: Record<string, never>): Promise<{ post: Row }>;
  getPost(required: { id: string }, optional?: Record<string, never>): Promise<{ post: Row }>;
  getPresentation(): Promise<Presentation>;
  /**
   * `expectedVersion` (2026-09-06) is the optimistic-concurrency basis, NOT a field of the post:
   * the {@link AdminPost.version} this editor loaded, sent so the server can reject a save whose
   * basis another operator's save has already superseded. Typed as its own member rather than
   * folded into the `Partial<Pick<AdminPost, …>>` bag precisely because it is not writable content
   * — nothing about it is stored, it is only compared.
   *
   * Optional here because the server treats it as optional (omit it and the save is last-write-wins,
   * exactly as before this feature). `usePostEditor` always sends it once a post has loaded; a
   * caller that omits it gets the old, unguarded behavior.
   *
   * Rejects with an `ApiError` carrying `code: "VERSION_CONFLICT"` (`rules.ts`'s
   * `POST_VERSION_CONFLICT_CODE`) when the basis is stale — distinct from the slug-uniqueness 409
   * this same route can also return, which carries no code at all.
   */
  updatePost(
    required: {
      target: { id: string };
      patch: Partial<Pick<Row, "title" | "slug" | "bodyJson" | "status" | "templateChoice" | "overridesThemePage" | "publishAt" | "featuredMediaId" | "author" | "showAuthor">> & {
        expectedVersion?: number | undefined;
        hideCoverImageInBody?: boolean;
        slugFromTitle?: boolean;
      };
    },
    optional?: Record<string, never>
  ): Promise<{ post: Row }>;
  deletePost(required: { id: string }, optional?: Record<string, never>): Promise<{ post: Row }>;
  /** Mention feature (2026-08-11, coordinator MSG #1 licensing sweep) — the picker list for
   *  "mention another post"; same wrapped-entry response shape `api.listPosts()` actually returns
   *  (confirmed against `use-posts.hooks.ts`'s own `r.posts.map((entry) => entry.post)`, not the
   *  type declaration alone). */
  listPosts(): Promise<{ posts: Array<{ post: Row }> }>;
  /** File-handler feature (2026-08-12) — uploads one dropped/pasted `File` through the SAME
   *  media-upload path `MediaPickerDialog`'s own upload flow already calls (`api.uploadMedia`), so
   *  a file dropped/pasted into the editor becomes a real media-library asset (`{assetId,
   *  transformName}` ref) rather than an inlined `data:` URL. `PostEditorPort` (not a direct `api`
   *  import) for the same reason every other route on this interface is injected — see this file's
   *  header — even though media itself is a different feature's domain; the editor is the only
   *  caller that needs it for THIS purpose (uploading whatever was just dropped, not browsing the
   *  library), so it belongs on this port rather than pulling in `features/media`'s own port. */
  uploadMedia(input: { filename: string; contentType: string; dataBase64: string }, optional?: Record<string, never>): Promise<{ media: AdminMedia }>;
  /**
   * Synchronous URL builder for the admin-only template-preview iframe/form target (2026-08-14, moved
   * out of `PostEditor.tsx`/`PostPreview` — see `apps/admin/INFO.md`'s Hooks section) — NOT a network
   * call itself; the browser navigates to the returned URL when the iframe's `src` is set or the
   * hidden form submits. `templateChoice: null` omits the query param (server renders the post's own
   * saved template); `""` sends an explicit empty value ("no template"); a real filename requests
   * that template. Mirrors `features/pages/hooks/page-editor-port.hooks.ts`'s identical member —
   * see `lib/api.ts`'s own `templatePreviewUrl` for the exact query-string contract both share.
   */
  templatePreviewUrl(required: { id: string; templateChoice: string | null }, optional?: Record<string, never>): string;
}
