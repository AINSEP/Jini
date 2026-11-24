import type { ThemePagesFileEntry, ThemePagesPort } from "./theme-pages-port.hooks.js";

/** Seed state for {@link createFakeThemePagesPort}. */
export interface FakeThemePagesPortOptions {
  /** Defaults to `"basic"` — the id of the theme every fresh workspace starts on, so a test that
   *  does not care which theme is active still gets a realistic one rather than an empty string
   *  that would silently produce a `?theme=` with no value. */
  activeThemeId?: string;
  /** `getThemeDetail`'s page-shaped file entries this fake theme ships — defaults to `[]` (a theme
   *  with no pages at all). A fixture may also include non-`"page"` group entries to prove those are
   *  filtered out rather than mis-rendered as rows. */
  pageFiles?: ThemePagesFileEntry[];
  /** When set, `getPresentation()` rejects with this instead of resolving — for load-failure
   *  tests. */
  getPresentationError?: Error;
  /** When set, `getThemeDetail()` rejects with this instead of resolving — for load-failure tests
   *  that need `activeThemeId` to have already resolved (mirrors the two-request chain the real
   *  hook now makes). */
  getThemeDetailError?: Error;
  /** When set, `setPagePublished()` rejects with this instead of resolving/mutating — for
   *  publish-failure tests. */
  setPagePublishedError?: Error;
}

/**
 * An in-memory {@link ThemePagesPort} for tests — "every port gets a fake" (see
 * `assistant-chats-dependencies.hooks.ts`). `setPagePublished` mutates its own `files` in place and
 * `getThemeDetail` re-reads from that same array, the same round-trip-provable shape
 * `theme-explore-dependencies.hooks.ts`'s `createFakeThemeExplorePort` already uses for the
 * identical route.
 */
export function createFakeThemePagesPort(options: FakeThemePagesPortOptions = {}): ThemePagesPort {
  let files = [...(options.pageFiles ?? [])];

  return {
    async getPresentation() {
      if (options.getPresentationError) throw options.getPresentationError;
      return { settings: { activeThemeId: options.activeThemeId ?? "basic" } };
    },

    async getThemeDetail() {
      if (options.getThemeDetailError) throw options.getThemeDetailError;
      return { files: [...files] };
    },

    async setPagePublished({ page, published }) {
      if (options.setPagePublishedError) throw options.setPagePublishedError;
      // Same basename-minus-`.html` derivation `theme-explore-dependencies.hooks.ts`'s own fake
      // uses for this route — a fake stand-in for the server's lookup, not a second copy of the
      // real predicate this port has no business re-implementing.
      const target = files.find((f) => f.group === "page" && f.path.slice(f.path.lastIndexOf("/") + 1) === `${page}.html`);
      if (!target) throw new Error(`fake theme page not found: ${page}`);
      files = files.map((f) => (f === target ? { ...f, published } : f));
      return { page, published };
    },
  };
}
