import type { ThemeCanvasPort, ThemeTokens } from "./theme-canvas-port.hooks.js";

/**
 * @file The only place `use-theme-canvas-styling.hooks.ts` reaches the real network — see
 * `theme-canvas-port.hooks.ts` for why the split exists and why this wraps global `fetch` directly
 * instead of `lib/api`'s `api` client.
 */

export class ThemeServerResponseError extends Error {
  readonly status: number;

  constructor({ status }: { status: number }, _options = {}) {
    super(`the theme server responded with ${status}`);
    this.status = status;
  }
}

/** The live implementation — same status-check shape `apps/admin/src/components/TemplateSource/template-source-dependencies.hooks.ts` uses for
 *  the sibling `/theme-assets/...` fetch, with `.json()`/`.text()` chosen per what each method
 *  actually returns (a theme template's own markup has no reason to be valid JSON). */
export const defaultThemeCanvasPort: ThemeCanvasPort = {
  async fetchThemeTokens({ url }: { url: string }): Promise<ThemeTokens> {
    const res = await fetch(url);
    if (!res.ok) throw new ThemeServerResponseError({ status: res.status });
    return (await res.json()) as ThemeTokens;
  },
  async fetchTemplateMarkup({ url }: { url: string }): Promise<string> {
    const res = await fetch(url);
    if (!res.ok) throw new ThemeServerResponseError({ status: res.status });
    return res.text();
  },
  async warmStylesheet({ url }: { url: string }): Promise<void> {
    // Best-effort only — see `ThemeCanvasPort.warmStylesheet`'s own doc. Neither a non-OK response nor
    // a network failure is reported; the real `<link>` GrapesJS loads is what surfaces a genuinely
    // broken stylesheet URL, not this warm-up.
    try {
      await fetch(url);
    } catch {
      // Swallowed intentionally.
    }
  },
};

/** Seed state for {@link createFakeThemeCanvasPort}. Keyed by URL so one fake can answer the theme's
 *  required `tokens.json` and its optional `tokens.light.json` differently — including "the light one
 *  404s", which is a supported real-world case, not an error. `templatesByUrl` is the same idea for
 *  template markup fetches. */
export interface FakeThemeCanvasPortOptions {
  tokensByUrl?: Record<string, ThemeTokens>;
  templatesByUrl?: Record<string, string>;
}

/**
 * An in-memory {@link ThemeCanvasPort} for tests — "every port gets a fake" (see
 * `theme-pages-dependencies.hooks.ts`). Any URL absent from `tokensByUrl`/`templatesByUrl` rejects,
 * matching what the real port does for a file the theme does not ship.
 */
export function createFakeThemeCanvasPort(options: FakeThemeCanvasPortOptions = {}): ThemeCanvasPort {
  return {
    async fetchThemeTokens({ url }: { url: string }) {
      const tokens = options.tokensByUrl?.[url];
      if (!tokens) throw new Error(`fake theme canvas port: nothing seeded at ${url}`);
      return tokens;
    },
    async fetchTemplateMarkup({ url }: { url: string }) {
      const markup = options.templatesByUrl?.[url];
      if (markup === undefined) throw new Error(`fake theme canvas port: nothing seeded at ${url}`);
      return markup;
    },
    // No-op in the fake — nothing to warm in-memory, and no real `fetch` to spy-guard against (see the
    // real port's own doc). Tests that need to assert this was called use `vi.spyOn(port, ...)`.
    async warmStylesheet() {},
  };
}
