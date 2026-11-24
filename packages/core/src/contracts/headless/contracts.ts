/**
 * A theme id. Open string under SPEC-004 because themes are discovered from disk, so
 * the valid set is dynamic.
 * Clients read the current valid ids from `availableThemeIds`.
 *
 * One value is RESERVED and never names a theme: `"none"` (`features/theme`'s `NO_THEME_ID`) means
 * the operator turned the theme off deliberately and the site renders unstyled. A headless client
 * reading `activeThemeId` must treat it as "no theme", not as a theme id to look up — asking for a
 * theme by that id 404s. It deliberately never appears in `availableThemeIds`, which is a catalogue
 * of themes a client can PICK, not a list of values the API will accept. No type change: the
 * sentinel is a legal `HeadlessThemeId` because this alias is an open string.
 */
export type HeadlessThemeId = HeadlessThemeSummary["id"];

/**
 * SPEC-002 (content-entry-authoring) discriminates a blog-style `"post"` from a
 * standalone `"page"` over the same underlying record shape (see
 * `features/post/post.ts`'s `PostKind` doc). Declared locally rather than
 * importing `features/post`'s `PostKind` — `headless` is the wire-contract
 * layer and stays decoupled from feature internals (mirrors `HeadlessThemeId`'s
 * open-string precedent just above); the two are kept in lockstep by
 * `toHeadlessPost`/`toHeadlessContentPost`, the only callers that populate it.
 */
export type HeadlessEntryKind = "post" | "page";

/**
 * SPEC-047/ADR-056 Decision 3 — discriminates which body an `AdminPost` actually carries. Declared
 * locally rather than importing `features/post`'s `PostBodyFormat`, for the same reason
 * `HeadlessEntryKind` is declared locally just above: `headless` is the wire-contract layer and
 * stays decoupled from feature internals; `toHeadlessPost` is the only place the two are kept in
 * lockstep.
 */
export type HeadlessBodyFormat = "doc" | "html";

interface AdminPostFields {
  /** Editable display credit, independent of the creator principal. */
  author?: string | null;
  showAuthor?: boolean;
  id: string;
  workspaceId: string;
  /** SPEC-002 api.spec.md §5 — entry kind. */
  kind: HeadlessEntryKind;
  title: string;
  slug: string;
  status: "draft" | "published";
  updatedAt: string;
  version: number;
  /**
   * SPEC-005 REQ-11/AC-14 — optional plugin extension-field bag,
   * namespaced per plugin (`{ [pluginId]: { …declaredFields } }`). Present only when a plugin has
   * actually written to this entry; an entry with no contributing plugin carries no `ext` key at
   * all.
   */
  ext?: Record<string, Record<string, unknown>>;
  /**
   * Optional `pages/*.html` filename (of the active static theme's
   * `theme.json` `postTemplate` array) this post renders through. `toHeadlessPost` always populates
   * a real value (`post.templateChoice ?? null`) on every live response, so a consumer only ever
   * sees `undefined` in a hand-built test fixture that predates this field, never from the real API.
   * `null` and `""` are NOT interchangeable — see `PostRecord.templateChoice` for the tri-state.
   */
  templateChoice?: string | null;
  /**
   * Optional slug-collision override: `null` means this post never had an explicit opinion set
   * (the resolver's current default policy applies), `true`/`false` is a permanent explicit author
   * choice. `toHeadlessPost` always populates a real value (`post.overridesThemePage ?? null`) on
   * every live response; `undefined` only appears in a pre-feature test fixture.
   */
  overridesThemePage?: boolean | null;
  /** Scheduled publishing — ISO UTC go-live instant; absent when not scheduled. A
   *  `published` post whose `publishAt` is in the future is not yet visible on the public site. */
  publishAt?: string;
  /** Featured image — media asset id; absent when the post has none. */
  featuredMediaId?: string;
}

/**
 * SPEC-047/ADR-056 Decision 3 / REQ-3 — a discriminated union, not one loose type with two optional
 * body fields. The trap this closes: TipTap silently discards markup outside its node vocabulary and
 * saves the loss with no error, so "never build a TipTap editor's props from an `html`-format row"
 * cannot be left to a runtime `if` a future refactor can quietly delete. Narrowing on `bodyFormat`
 * (e.g. `if (post.bodyFormat === "doc")`) is the only way to reach a non-null `bodyJson` — a caller
 * that does not narrow, or narrows on the wrong field, gets a type error, not a runtime surprise. See
 * `admin-post-response.type.test.ts` for the compile-time proof.
 */
export type AdminPost =
  | (AdminPostFields & { bodyFormat: "doc"; bodyJson: Record<string, unknown>; bodyHtml: null })
  | (AdminPostFields & { bodyFormat: "html"; bodyJson: null; bodyHtml: string });

export interface AdminPostEnvelope {
  post: AdminPost;
}

interface ContentPostFields {
  author?: string | null;
  showAuthor?: boolean;
  id: string;
  /** SPEC-002 api.spec.md §5 (`CONTENT_ENTRY_BY_SLUG`) — entry kind. */
  kind: HeadlessEntryKind;
  title: string;
  slug: string;
  updatedAt: string;
}

/** Document responses retain their original shape; HTML responses carry their actual body. */
export type ContentPost =
  | (ContentPostFields & { bodyFormat?: "doc"; bodyJson: Record<string, unknown>; bodyHtml?: null })
  | (ContentPostFields & { bodyFormat: "html"; bodyJson: null; bodyHtml: string });

/**
 * ADR-020 capability tier, mirrored locally from `features/theme`'s `ThemeTier` for the same
 * decoupling reason as `HeadlessEntryKind` above — the wire contract doesn't import feature
 * internals. Kept in lockstep by `toAdminPresentationResponse`, the only place that populates it.
 */
export type HeadlessThemeTier = "declarative" | "templated" | "handlebars" | "static" | "code";

export interface HeadlessThemeSummary {
  /** Existing screenshot URL, or null when the theme has no preview image. */
  previewImageUrl?: string | null;
  id: string;
  /** The theme's display name — `theme.json`'s `name`, or the id when the manifest has none
   *  (`ThemeManifest.name`'s own fallback, `theme.ts`). What the admin shows the owner; the id
   *  stays the key. */
  name: string;
  tier: HeadlessThemeTier;
  /**
   * The theme's manifest `apiVersion` (`2`, or `undefined` for v1) tells the admin whether page
   * templates live under `pages/` (v1) or `render/pages/` (v2). Mirrors `ThemeManifest.apiVersion`.
   */
  apiVersion?: 2;
  /** Ships with the package itself (its originals catalog has this id), so the Themes screen does
   *  not offer to delete it. A copy of a shipped theme is `false`. Optional for older servers. */
  builtIn?: boolean;
}

export interface AdminPresentation {
  settings: {
    workspaceId: string;
    activeThemeId: HeadlessThemeId;
    updatedAt: string;
  };
  availableThemeIds: HeadlessThemeId[];
  /**
   * Themes admin screen — every available theme's id plus its ADR-020 capability
   * tier, so the Themes screen can group cards by tier without a second round trip. Same id set
   * as `availableThemeIds` above (that field stays for callers that only need ids); this is the
   * superset callers that need tier read instead.
   */
  availableThemes: HeadlessThemeSummary[];
  /**
   * Template picker — the active theme's `theme.json`
   * `templates` array (e.g. `["blog-post.html", "page-shell.html"]`), or `[]` when the active theme
   * doesn't declare one. BOTH the Post editor's and the Pages editor's picker read this SAME field to
   * populate their options. The unified `content` marker makes the template list common;
   * see `ThemeManifest.templates` (`features/theme/theme.ts`) for the
   * historical reasoning). Editor GETs now supply `kind=post` or `kind=page` to filter this
   * array using `ThemeManifest.templateFor`, preserving manifest order. Omitting kind retains the
   * full catalog. An empty array means a picker has nothing to offer and stays hidden unless its
   * content row already has a saved choice, which the editor keeps visible.
   */
  activeThemeTemplates: string[];
  /**
   * Slug-collision override — every page id (`theme.pages` key) the active theme ships,
   * or `[]` for a non-`static`-tier theme. The Post editor uses this to warn an author when a post's
   * slug matches one of these — that slug's route currently belongs to the theme's own page, not the
   * post, unless the post's `overridesThemePage` is set.
   */
  activeThemeStaticPageIds: string[];
}

export interface ContentPostPayload {
  post: ContentPost;
  presentation: {
    activeThemeId: HeadlessThemeId;
  };
}
