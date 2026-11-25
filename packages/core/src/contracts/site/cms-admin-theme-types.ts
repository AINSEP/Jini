/** Which part of a theme a file is (`GET .../themes/:id/files`). */
export type ThemeFileGroup = "page" | "partial" | "style" | "script" | "config" | "asset" | "other";

export interface PresentationSettings {
  workspaceId: string;
  activeThemeId: string;
  updatedAt: string;
}

/**
 * ADR-020 capability tier, mirrored client-side from the host server's headless contract's `HeadlessThemeTier` —
 * same decoupling precedent as every other client-side type in this file that mirrors a wire
 * contract rather than importing server internals.
 */
export type ThemeTier = "declarative" | "templated" | "handlebars" | "static" | "code";

/** Themes admin screen (2026-08-10) — one available theme's id plus its capability tier. */
export interface AdminThemeSummary {
  previewImageUrl?: string | null;
  id: string;
  /** `theme.json`'s display name (the server falls back to the id) — what the owner sees; the id
   *  stays the key. Optional so a response or test double without it still type-checks. */
  name?: string;
  tier: ThemeTier;
  /** Manifest schema version (`2`, or `undefined` for v1) — mirrored client-side from
   *  the host server's headless contract's `HeadlessThemeSummary.apiVersion` (2026-08-19 architecture audit finding 1),
   *  same decoupling precedent as `ThemeTier`'s own doc comment. Feeds `PostTemplateModal`'s "View
   *  Template" fetch, which needs to know whether this theme's page templates live under `pages/`
   *  or `render/pages/`. */
  apiVersion?: 2;
  /** Ships with the package (mirrors `HeadlessThemeSummary.builtIn`): the Themes card menu won't
   *  offer to delete it. Absent from older servers. */
  builtIn?: boolean;
}
