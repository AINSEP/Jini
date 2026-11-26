import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Translate } from "@jini-ai/core/text";
import type { AdminPost } from "../../posts/api/posts-api.types.js";
import type { AdminPagePluginEmbed } from "../api/pages-api.types.js";
import type { PageEditorDependencies } from "./use-page-editor.hooks.js";

import type { usePageEditorWorkspace } from "./page-editor-workspace.hooks.js";
/**
 * Applies a loaded row into the working copy AND the saved baseline — the mount effect's own
 * initialization, named out so `applyExternalPage` (an assistant write landing while the editor is
 * open, 2026-09-16) can seed the SAME fields from the SAME row shape rather than a second,
 * independently-maintained copy of this list drifting from it over time.
 *
 * UNLIKE `usePostEditor`'s equivalent, no "default to the theme's first template" here — `null` is a
 * Page's normal, fully-working state (render its own body), not an absence-of-decision that needs
 * papering over. `pageEditableHtml` (`rules.ts`) is the single place that decides whether `bodyHtml`
 * is real editable content for this row.
 *
 * @complexity Time/space: O(1).
 */
export function applyLoadedPage(
  { post, setters, pageEditableHtml }: { post: AdminPost; pageEditableHtml: PageEditorDependencies["pageEditableHtml"];
  setters: {
    setPage: (page: AdminPost) => void;
    setTitle: (value: string) => void;
    setSlug: (value: string) => void;
    setStatus: (value: "draft" | "published") => void;
    setTemplateChoice: (value: string | null) => void;
    setSavedTemplateChoice: (value: string | null) => void;
    setHtml: (value: string) => void;
    setSavedHtml: (value: string) => void;
  } },
  _optional = {},
): void {
  setters.setPage(post);
  setters.setTitle(post.title);
  setters.setSlug(post.slug);
  setters.setStatus(post.status);
  setters.setTemplateChoice(post.templateChoice ?? null);
  setters.setSavedTemplateChoice(post.templateChoice ?? null);
  const body = pageEditableHtml(post);
  setters.setHtml(body);
  setters.setSavedHtml(body);
}

function canonicalPageRedirect({ post, routeSlug, deps }: { post: AdminPost; routeSlug: string; deps: PageEditorDependencies }, _options = {}): string | null {
  const { HOME_PAGE_HANDLE, pageAdminPath, slugRedirectPath } = deps;
  if (post.slug === "/") return routeSlug === post.id ? pageAdminPath(post) : null;
  if (post.slug === HOME_PAGE_HANDLE) return null;
  return slugRedirectPath({ base: "/pages", requestedId: routeSlug, item: post });
}

export function usePageEditorLoad(input: { routeSlug: string; deps: PageEditorDependencies }, _optional = {}) {
  const { routeSlug, deps } = input;
  const { useCachedLoader, useInvalidate, useFetchMutation } = deps.hooks;
  const { HOME_PAGE_HANDLE, parseEmbedMarkerConfig, embedMarkerTarget, PageBodyWriteError, createEmbedPlaceholderDescriber } = deps;

  const { port, themeCanvasPort, navigate, t, locale } = deps;
  // Memoized (not a plain `const` closure) so `embedPlaceholderDescriber` below has a stable
  // dependency to key its own `useMemo` off: `deps.t` is a stable module-level singleton in
  // production (see this function's own doc), so this identity only changes when `locale` does.
  const boundT: Translate = useMemo(() => (key: string) => t({ locale, key }), [t, locale]);
  /**
   * Bug A (2026-09-23 interactive-bugs plan, Slice A3): built once here, not in `PageEditor.tsx`, so
   * the `.tsx` stays markup-only (this feature's own "no logic in `.tsx`" rule — see
   * `lib/embed-placeholder.ts`'s own file header). `InteractiveHtmlEditor` (`@jini-ai/ui/html-editor`)
   * reads `describeEmbedPlaceholder` once, at mount, and never reacts to a later prop change (same
   * mount-once contract as `html`/`canvasStyling`), so this identity changing on a locale switch is
   * harmless — the NEXT mount (a fresh Interactive-tab visit) picks up the new translator.
   */
  // The canvas captures its describer at mount; a ref supplies the latest server readiness.
  const pluginEmbeds = useRef<readonly AdminPagePluginEmbed[]>([]);
  const embedPlaceholderDescriber = useMemo(() => createEmbedPlaceholderDescriber({ t: boundT, parseEmbedMarkerConfig, embedMarkerTarget }, { pluginEmbeds: () => pluginEmbeds.current }), [boundT, createEmbedPlaceholderDescriber, parseEmbedMarkerConfig, embedMarkerTarget]);
  const pageKey = useMemo(() => ["pages", "detail", routeSlug] as const, [routeSlug]);
  const fetchPage = useCallback(async () => {
    const result = await port.getPage({ routeSlug: routeSlug === HOME_PAGE_HANDLE ? "/" : routeSlug });
    pluginEmbeds.current = result.pluginEmbeds ?? [];
    return result;
  }, [port, routeSlug]);
  const pageLoader = useCachedLoader({ key: pageKey, fetch: fetchPage }, { staleTime: 0 });
  const readPage = useCallback((id: string) => pageLoader.load({ key: ["pages", "detail", id], fetch: async () => {
    const result = await port.getPage({ routeSlug: id });
    pluginEmbeds.current = result.pluginEmbeds ?? [];
    return result;
  } }), [port, pageLoader]);
  const invalidate = useInvalidate();
  const fetchInitial = useCallback(async () => {
    // Loaded together: an empty template picker must not flash while presentation lags the page.
    return Promise.all([pageLoader.load(), port.getPresentation()]);
  }, [port, pageLoader, routeSlug]);
  const initialKey = useMemo(() => ["pages", "editor", routeSlug] as const, [routeSlug]);
  const initial = useCachedLoader({ key: initialKey, fetch: fetchInitial }, { staleTime: 0 });
  const hydratedRoute = useRef<string | null>(null);
  const write = useFetchMutation({ run: async ({ input }: { input: () => Promise<unknown> }) => {
    try { return await input(); }
    catch (error) {
      // Metadata already landed even though the body write failed; dependent lists must learn
      // that accepted version while the editor retains its existing partial-success recovery.
      if (error instanceof PageBodyWriteError) invalidate({ key: ["pages"] });
      throw error;
    }
  } }, { invalidates: [["pages"]] });
  return { ...input, port, themeCanvasPort, navigate, t, locale, boundT, pluginEmbeds, embedPlaceholderDescriber, pageKey, fetchPage, pageLoader, readPage, invalidate, fetchInitial, initialKey, initial, hydratedRoute, write };
}

export function usePageEditorHydration(input: ReturnType<typeof usePageEditorWorkspace>, _optional = {}) {
  const { routeSlug, deps, navigate, t, locale, initial, hydratedRoute, setPage, setError, setTitle, setSlug, setStatus, setTemplateChoice, setSavedTemplateChoice, setAvailableTemplates, setActiveThemeId, setActiveThemeApiVersion, setActiveThemeTier, setHtml, setSavedHtml } = input;

  const { editorTemplateOptions, pageEditableHtml, slugRedirectPath } = deps;

  // The previous load effect ran only for the route, even when locale changed. Keep the draft
  // captured once per route; locale changes may refresh the loader without replacing typed text.
  // `port` is stable in production (`useWiredPageEditor` uses a module-level singleton).
  // Initial loading captures locale; a hydrated route retains its draft.
  const loadInputs = useRef({ navigate, t, locale });
  loadInputs.current = { navigate, t, locale };
  useEffect(() => {
    let cancelled = false;
    const { navigate, t, locale } = loadInputs.current;
    // Loaded together, same reasoning as `usePostEditor`'s identical `Promise.all` — the picker
    // needs `activeThemeTemplates` in hand before it can render anything meaningful, and a fast
    // page-load racing a slow presentation-settings load would otherwise flash an empty picker.
    if (hydratedRoute.current === routeSlug) return undefined;
    // Reopening must hydrate from this mount's settled read, never the retained cache snapshot.
    // Once hydrated, background invalidations must not replace the operator's local draft.
    initial.load()
      .then(([{ post }, { activeThemeTemplates, activeThemeId: themeId, activeThemeApiVersion: themeApiVersion, activeThemeTier: themeTier }]) => {
        if (cancelled) return;
        hydratedRoute.current = routeSlug;
        setAvailableTemplates(editorTemplateOptions({ templates: activeThemeTemplates, savedTemplate: post.templateChoice }));
        setActiveThemeId(themeId);
        setActiveThemeApiVersion(themeApiVersion);
        setActiveThemeTier(themeTier);
        applyLoadedPage({ post, setters: { setPage, setTitle, setSlug, setStatus, setTemplateChoice, setSavedTemplateChoice, setHtml, setSavedHtml }, pageEditableHtml });
        // Old id bookmarks catch up to the canonical URL. Keep the root page out of the generic
        // slug redirect (`/pages//` cannot match), and keep a real `home` page on its id so it
        // cannot redirect into the root alias.
        const canonicalPath = canonicalPageRedirect({ post, routeSlug, deps });
        if (canonicalPath) navigate(canonicalPath, { replace: true });
      })
      .catch(() => {
        if (!cancelled) setError(t({ locale, key: "failed to load page" }));
      });
    return () => {
      cancelled = true;
    };
  }, [routeSlug, initial, editorTemplateOptions, pageEditableHtml, slugRedirectPath]);
  return { ...input, loadInputs };
}
