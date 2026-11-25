import type { JsonRouteAuthorize, RouteInputContext } from "@jini-ai/core/contracts/server";
import { describeErrorForLog } from "@jini-ai/core/model-facing-tool-errors";

import { authorizeThemes, type ThemeRoutePrincipal } from "./shared.js";

/**
 * @file `GET /api/admin/v1/workspaces/:ws/themes/:themeId/preview` — a Themes card's picture of the
 * theme's OWN render.
 *
 * Why it exists: a card used to show the theme's shipped `screenshots/index.*`, a static file that a
 * duplicate, an import or a theme built from the starter carries over verbatim from its source, and
 * that nothing ever regenerates after an edit — so every theme copied from the starter showed the
 * starter's picture. Now the card asks this route, which screenshots
 * `/theme-explore/<id>/<page>` (the same real render the Explore preview iframe shows) whenever the
 * theme's files are newer than the stored capture (`contentVersion`), and serves that.
 *
 * The capture queue, store and browser are the Sites cards' (the host's site-preview service), one
 * queue per served site. Unlike the Sites listing, this waits for a due
 * capture (bounded by `waitMs`): it is an `<img>` request, so the card fills in when the picture is
 * ready instead of showing a stale one until the next visit. A capture that cannot be made (no
 * Chromium, a page that fails to load, a slow drain) answers with the shipped screenshot, uncached,
 * or `404` so the card shows its placeholder.
 *
 * Static tier only: the capture browser carries no admin session, and only static pages render at
 * `/theme-explore/` ungated. The listing never points another tier here.
 *
 * Wire: `bufferedReply: "redirect"` keeps the hand-written route's `res.send(bytes)` (Content-Length,
 * ETag, 304) and `res.redirect(302, url)` (the Accept-negotiated body), and a `404` carries the JSON
 * exactly as `res.status(404).json(...)` serialized it. The host's ports write the workspace 404, the
 * session/permission refusals and the redacted 500.
 */

/** The fields of one discovered theme this route reads. */
export interface ThemePreviewRouteTheme {
  readonly status: string;
  readonly manifest: { readonly id: string; readonly tier: string };
  /** Absolute folder the theme was loaded from; the host's version/shipped-image lookups key on it. */
  readonly dir: string;
  readonly pages?: Readonly<Record<string, unknown>> | undefined;
}

/** The host's capture queue: stored versions, a due capture's enqueue, its bytes, and a drain signal. */
export interface ThemePreviewCaptureQueue {
  versions(required: {
    readonly sites: readonly { readonly name: string; readonly createdAt: string }[];
    readonly targets: readonly { readonly name: string; readonly url: string; readonly lifecycle: string }[];
  }): Readonly<Record<string, number>>;
  read(required: { readonly name: string }): Uint8Array | null;
  idle(): Promise<void>;
}

/** The deps this route reads; the host binds `themes` and `servingAddress` to the request. */
export interface ThemePreviewRouteDeps {
  /** The host's live discovered themes, read when the request arrives. */
  readonly themes: readonly ThemePreviewRouteTheme[];
  /** The capture queue; `undefined` = captures are off, the shipped screenshot answers. */
  readonly previews: ThemePreviewCaptureQueue | undefined;
  /** This server's own listening scheme and port for the request, or `undefined` when it has none. */
  readonly servingAddress: () => { readonly scheme: "http" | "https"; readonly port: number } | undefined;
  /** The newest edit time (ms) of the theme's files. */
  readonly contentVersion: (required: { dir: string }) => number;
  /** The theme's shipped screenshot URL, or `null` — the fallback when no capture can be served. */
  readonly shippedImage: (required: { dir: string; id: string }) => string | null;
  /** Longest an image request waits for a due capture before answering with the fallback. */
  readonly waitMs: number;
  /** The media type the host's preview store writes (`Content-Type` of every 200). */
  readonly previewContentType: string;
}

/** The server-neutral raw route (K1 §9.3), structurally an http-kit `RawRouteSpec`. */
export interface ThemePreviewRawRoute<Deps extends ThemePreviewRouteDeps = ThemePreviewRouteDeps> {
  readonly method: "get";
  readonly path: string;
  readonly bufferedReply: "redirect";
  handle(
    required: { readonly raw: RouteInputContext; readonly deps: Deps; readonly context: ThemeRoutePrincipal | undefined; readonly authorize: JsonRouteAuthorize },
    optional: { readonly signal: AbortSignal },
  ): Promise<Response>;
}

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };

/** A JSON answer written exactly as `res.status(s).json(body)` serialized it. @complexity O(1). */
function jsonAnswer({ status, body, headers = {} }: { status: number; body: unknown; headers?: Record<string, string> }, _optional = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, ...JSON_HEADERS } });
}

/** The page a capture renders: `index` when the theme has one, else its first page. @complexity O(p). */
function capturePageId(theme: ThemePreviewRouteTheme): string | null {
  const pages = Object.keys(theme.pages ?? {});
  return pages.includes("index") ? "index" : pages[0] ?? null;
}

/** Resolves after `ms`, or when `work` settles — whichever is first. Never rejects. */
function settleWithin({ work, ms }: { work: Promise<void>; ms: number }, _optional = {}): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => { timer = setTimeout(resolve, ms); });
  return Promise.race([work.catch((error: unknown) => {
    console.warn("[theme-preview] Could not wait for the preview capture:",
      describeErrorForLog({ err: error }));
  }), timeout]).finally(() => clearTimeout(timer));
}

/** Read a current capture, waiting for the existing queue only when this theme needs one. */
async function readThemeCapture(
  { theme, themeId, deps }: { theme: ThemePreviewRouteTheme; themeId: string; deps: ThemePreviewRouteDeps },
  _optional = {},
): Promise<Uint8Array | null> {
  const previews = deps.previews;
  const pageId = capturePageId(theme);
  if (!previews || pageId === null) return null;
  const version = deps.contentVersion({ dir: theme.dir });
  // The queue's "older than createdAt is unusable" rule is exactly "captured before the last edit".
  const site = { name: themeId, createdAt: new Date(version).toISOString() };
  let captured = previews.versions({ sites: [site], targets: [] })[themeId];
  const serving = deps.servingAddress();
  if (captured === undefined && serving) {
    const url = `${serving.scheme}://localhost:${serving.port}/theme-explore/${encodeURIComponent(themeId)}/${encodeURIComponent(pageId)}`;
    previews.versions({ sites: [site], targets: [{ name: themeId, url, lifecycle: String(version) }] });
    await settleWithin({ work: previews.idle(), ms: deps.waitMs });
    captured = previews.versions({ sites: [site], targets: [] })[themeId];
  }
  return captured === undefined ? null : previews.read({ name: themeId });
}

/** The answer when no current capture exists: the shipped screenshot, else the placeholder 404. */
function fallbackAnswer({ theme, themeId, deps }: { theme: ThemePreviewRouteTheme; themeId: string; deps: ThemePreviewRouteDeps }, _optional = {}): Response {
  // `no-store`: the next request may well have a capture to show.
  const fallback = deps.shippedImage({ dir: theme.dir, id: themeId });
  const headers = { "Cache-Control": "no-store" };
  if (fallback === null) return jsonAnswer({ status: 404, body: { code: "THEME_PREVIEW_NOT_FOUND", error: "no preview" }, headers });
  return new Response(null, { status: 302, headers: { ...headers, Location: fallback } });
}

/**
 * `GET .../themes/:themeId/preview` — the theme's own capture, the shipped screenshot, or a 404.
 * @complexity O(t + f) per request for t themes and the theme's f files (one tree walk), plus at
 *   most one capture (~1–2 s) when the theme changed since the last one.
 */
export const themePreviewRoute: ThemePreviewRawRoute = {
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/themes/:themeId/preview",
  bufferedReply: "redirect",
  async handle({ raw, deps, authorize }) {
    // Same permission as the presentation listing that hands out this URL.
    await authorizeThemes({ authorize, permission: "theme.set", entityType: "presentation" });
    const themeId = String(raw.params.themeId ?? "");
    const theme = deps.themes.find((t) => t.status === "valid" && t.manifest.id === themeId && t.manifest.tier === "static");
    if (!theme) return jsonAnswer({ status: 404, body: { code: "THEME_NOT_FOUND", error: "no such static theme" } });

    const bytes = await readThemeCapture({ theme, themeId, deps });
    if (bytes === null) return fallbackAnswer({ theme, themeId, deps });
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": deps.previewContentType,
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  },
};
