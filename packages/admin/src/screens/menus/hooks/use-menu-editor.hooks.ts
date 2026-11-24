import { useCallback, useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { type Translate } from "@jini-ai/core/text";
import type { AdminMenu, AdminMenuItem, AdminMenuMode } from "../api/menus-api.types.js";
import type { MenusHostKit } from "../menus-host-kit.js";
import { hasPageLinks, type MenuPageChoice } from "../page-link-rules.js";
import type { MenuItemIdSource } from "./menu-tree.js";
import type { MenusPort } from "./menus-port.hooks.js";
import { hydrateMenuForm, type MenuEditorState, type MenuFormState } from "./use-menu-editor-state.hooks.js";
import type { MenuEditorClipboard } from "./use-menu-editor-writes.hooks.js";

/**
 * @file Everything the per-menu tree editor does, so `MenuEditor.tsx` is only markup.
 *
 * Extracted verbatim — same state, same order, same effect, same error strings. `props.menuId ===
 * null` is create mode (unsaved menu, empty tree to start); a non-null id loads and edits an
 * existing menu. Split into sub-hooks behaviour-identically: the state cells and setters live in
 * `use-menu-editor-state.hooks.ts`, Copy HTML embed and Save in `use-menu-editor-writes.hooks.ts`,
 * the immutable tree operations (`mapAtPath` … `moveAtPath`) and the `newItem` factory in
 * `menu-tree.ts`. `countDescendants` and `targetForKind` stay with the editor markup — they're only
 * ever called from inside `ItemRow`'s own markup (confirm copy, select-driven target reshaping), not
 * from this hook's state transitions.
 *
 * Naming follows the `use-<thing>.hooks.ts` convention. Screen-local because nothing outside the
 * menus screen needs it.
 *
 * `deps.port`/`deps.navigate` are injected (see `menus-port.hooks.ts`) rather than reaching for the
 * host's admin client and router directly, sharing the `MenusPort` `use-menus.hooks.ts` also
 * injects. `deps.kit` carries the host's version-conflict test, slug rule, slug-redirect rule and
 * failure channel (`menus-host-kit.ts`).
 *
 * The state/action hooks and the write hooks (`useMenuEditorState`, `useMenuFieldActions`,
 * `useMenuItemActions`, `useMenuCopyEmbed`, `useMenuSave`) are not imported here: they are required
 * fields of `deps.kit`, which the host fills with the implementations in the two sibling files.
 *
 * `deps.t` (standing i18n rule, 2026-08-11 — see `use-menus.hooks.ts`'s identical note): injected
 * so `MenuEditor.tsx` (and `ItemRow`, which it threads `t` into as a prop) source their UI copy
 * from this hook instead of their own locale/dictionary import. This hook's OWN error strings stay
 * hardcoded English (unchanged) — the host reads its admin locale and menus dictionary only inside
 * its wired binding.
 */

export interface MenuEditorDependencies {
  port: MenusPort;
  navigate: (path: string, options?: { replace?: boolean }) => void;
  t: Translate;
  /** The host's version-conflict test, slug rules and failure channel — see `menus-host-kit.ts`. */
  kit: MenusHostKit;
  clipboard?: MenuEditorClipboard;
  /** Draft item IDs retain their browser UUID / timestamp fallback with controllable entropy. */
  itemIdSource?: MenuItemIdSource;
}

export interface MenuEditorController {
  pageChoices?: MenuPageChoice[] | undefined;
  copyHtmlEmbed: () => Promise<void>;
  copyFeedback: string | null;
  isNew: boolean;
  menu: AdminMenu | null;
  title: string;
  setTitle: (required: { next: string }, optional?: Record<string, never>) => void;
  slug: string;
  setSlug: (required: { next: string }, optional?: Record<string, never>) => void;
  items: AdminMenuItem[];
  /** The active tab: `"items"` ("Options", the tree editor) or `"html"` (raw menu markup). Save
   *  saves this mode; a menu stored in HTML mode opens on the HTML tab. */
  mode: AdminMenuMode;
  /** Switches tabs. The first switch to HTML with no markup yet seeds `menuHtmlStarter` from
   *  the current items (forms' `changeMode` rule); the other mode's data is never cleared. */
  changeMode: (mode: AdminMenuMode) => void;
  html: string;
  setHtml: (html: string) => void;
  message: string | null;
  error: string | null;
  loading: boolean;
  confirmLeave: () => boolean;
  changeAt: (required: { path: number[]; fn: (item: AdminMenuItem) => AdminMenuItem }, optional?: Record<string, never>) => void;
  removeAt: (required: { path: number[] }, optional?: Record<string, never>) => void;
  addChildAt: (required: { path: number[] }, optional?: Record<string, never>) => void;
  moveAt: (required: { path: number[]; direction: -1 | 1 }, optional?: Record<string, never>) => void;
  addRootItem: () => void;
  save: () => Promise<void>;
  /**
   * Whether a Save request is currently in flight (S4a, 2026-09-20) — the button had no `disabled`
   * at all, unlike Pages/Posts' twin `saving` field (`PageEditorController.saving`,
   * `PostEditorController.saving` from the same pass, `use-post-editor.hooks.ts` M4). A double click
   * sent two `updateMenuTree` calls carrying the same `expectedVersion`; the first landed, the
   * second's basis was already stale, so the operator saw an error line next to "Saved". Unlike
   * Pages/Posts, this screen has no "later click wins" intent to preserve (Menus has one action, not
   * a Save-vs-Publish race), so `save()` itself drops a same-tick re-entry via a synchronous
   * `useRef` guard rather than letting a second write reach the port at all — see `save()`'s own
   * comment.
   */
  saving: boolean;
  /** Bound translator — `MenuEditor.tsx`'s only source of UI copy; see this file's own header. */
  t: Translate;
}

/** The cached per-menu loader; a non-Error rejection becomes the translated load-failure copy. */
function useMenuLoader({ menuId, port, t, useCachedLoader }: { menuId: string | null; port: MenusPort; t: Translate; useCachedLoader: MenusHostKit["useCachedLoader"] }, _optional = {}) {
  const fetchMenu = useCallback(async () => {
    if (menuId === null) throw new Error("menu editor has no menu id to load");
    try { return await port.getMenu({ id: menuId }); }
    catch (error) { throw new Error(error instanceof Error ? error.message : t("failed to load menu")); }
  }, [menuId, port, t]);
  const menuKey = useMemo(() => ["menus", "detail", menuId ?? "new"] as const, [menuId]);
  return useCachedLoader({ key: menuKey, fetch: fetchMenu }, { staleTime: 0 });
}

/** The page catalogue, fetched only while the tree holds a page link. */
function useMenuPageChoices({ port, items, useFetchQuery }: { port: MenusPort; items: AdminMenuItem[]; useFetchQuery: MenusHostKit["useFetchQuery"] }, _optional = {}): MenuPageChoice[] | undefined {
  const needsPages = hasPageLinks({ items });
  const pageQueryFetch = useCallback(async () => {
    if (!port.listPages) throw new Error("menu editor page lookup is unavailable");
    return (await port.listPages({})).pages;
  }, [port]);
  const pageQuery = useFetchQuery({ key: ["menus", "page-options"], fetch: pageQueryFetch }, { enabled: needsPages && !!port.listPages, staleTime: 0 });
  return needsPages ? pageQuery.data : undefined;
}

interface MenuLoadEffectArgs {
  menuId: string | null; isNew: boolean; state: MenuEditorState; loader: ReturnType<typeof useMenuLoader>;
  navigate: MenuEditorDependencies["navigate"]; kit: MenusHostKit;
}

// Stale-response guard (2026-08-12 audit finding): this is a route-param loader — the panel
// router reuses this same component/hook across `/new` and every `/:id`, so navigating from one
// menu to another (or from an existing menu to `/new`) can let an OLDER `getMenu` response land
// after a NEWER one, overwriting the currently-viewed menu with a previous one's data (or, for
// `/new`, populating a blank editor with a stale record — the operator would then be editing and
// saving over the wrong menu). `cancelled` is flipped by this same effect's own cleanup the
// instant `menuId`/`isNew` changes again, before the new run starts — guarded on every completion
// path (`then`/`catch`/`finally`), not just the success path, since an unguarded `finally`
// clearing `loading` is the one most likely to leave stale data on screen with no spinner to flag
// it.
// The loader captures the port; an already hydrated route retains its draft.
function useMenuLoadEffect({ menuId, isNew, state, loader, navigate: currentNavigate, kit }: MenuLoadEffectArgs, _optional = {}): void {
  const hydratedRoute = useRef<string | null | undefined>(undefined);
  const loadNavigation = useRef(currentNavigate);
  loadNavigation.current = currentNavigate;
  const kitRef = useRef(kit);
  kitRef.current = kit;
  const { setCopyFeedback, slugEdited, setLoading, setError } = state;
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    if (hydratedRoute.current === menuId) return undefined;
    const navigate = loadNavigation.current;
    let cancelled = false;
    setCopyFeedback(null);
    slugEdited.current = false;
    if (isNew) {
      hydrateMenuForm({ state: stateRef.current, menu: null });
      setLoading(false);
      hydratedRoute.current = menuId;
      return undefined;
    }
    setLoading(true);
    setError(null);
    // Await a fresh version on every route entry; a retained cache value is only display data.
    loader.load()
      .then(({ menu }) => {
        if (cancelled) return;
        hydratedRoute.current = menuId;
        hydrateMenuForm({ state: stateRef.current, menu });
        // readable-slugs S6b: an old id-based bookmark quietly catches up to the slug URL, same
        // `slugRedirectPath` (`shell/lib/slug-redirect-path.ts`) rule posts/pages/widgets already apply.
        const redirectPath = kitRef.current.slugRedirectPath({ base: "/menus", requestedId: menuId as string, item: menu });
        if (redirectPath) navigate(redirectPath, { replace: true });
      })
      .catch((e) => {
        if (cancelled) return;
        // Always an `Error`: `fetchMenu` above rethrows every failure as one (with the translated
        // "failed to load menu" fallback for a non-Error rejection), so no second fallback here.
        setError((e as Error).message);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // The setters and `slugEdited` are stable across renders, so listing them keeps the same re-run
    // triggers as before the split: `menuId`, `isNew` and `loader`.
  }, [menuId, isNew, loader, setCopyFeedback, slugEdited, setLoading, setError]);
}

/** `activeMenuIdRef` always holds the latest `menuId` this hook was RENDERED with. */
function useActiveMenuIdRef({ menuId }: { menuId: string | null }, _optional = {}): MutableRefObject<string | null> {
  // Stale-response guard, save() half (2026-08-12 audit finding): the load effect's `cancelled`
  // flag above is scoped to a single effect run and flipped by that SAME effect's own cleanup — but
  // save() isn't an effect, so a route change mid-save never flips it. `activeMenuIdRef` always
  // holds the latest `menuId` this hook was RENDERED with (updated every render, not just on effect
  // re-run), so save()'s completion handlers can tell whether the operator has already navigated to
  // a different menu by the time create/update resolves, and skip committing state that belongs to
  // a menu no longer on screen. The `isNew` branch's own `navigate()` + early `return` stays
  // unguarded on purpose: it must always fire to land the operator on the menu they just created.
  const activeMenuIdRef = useRef(menuId);
  activeMenuIdRef.current = menuId;
  return activeMenuIdRef;
}

const DEFAULT_ITEM_ID_SOURCE = (): MenuItemIdSource => ({ crypto: globalThis.crypto, nowMs: Date.now, random: Math.random });

export function useMenuEditor(
  { menuId, dependencies: { port, navigate, t, kit, clipboard, itemIdSource = DEFAULT_ITEM_ID_SOURCE() } }: { menuId: string | null; dependencies: MenuEditorDependencies },
  _optional = {},
): MenuEditorController {
  const { useMenuEditorState, useMenuFieldActions, useMenuItemActions, useMenuCopyEmbed, useMenuSave, useCachedLoader, useDirtyGuard, useFetchQuery } = kit;
  const isNew = menuId === null;
  const loader = useMenuLoader({ menuId, port, t, useCachedLoader });
  const state = useMenuEditorState({ isNew });
  const { menu, title, slug, items, mode, html, original } = state;
  const pageChoices = useMenuPageChoices({ port, items, useFetchQuery });
  useMenuLoadEffect({ menuId, isNew, state, loader, navigate, kit });
  const { confirmLeave } = useDirtyGuard<MenuFormState>({ current: { title, slug, items, mode, html }, original }, { host: window, translate: (key) => key });
  const activeMenuIdRef = useActiveMenuIdRef({ menuId });
  const { save, saving } = useMenuSave({ state, menuId, isNew, activeMenuIdRef, port, navigate, t, kit, pageChoices });
  const copyHtmlEmbed = useMenuCopyEmbed({ state, menuId, activeMenuIdRef, clipboard, t, kit });
  const fields = useMenuFieldActions({ state, isNew, kit, pageChoices });
  const tree = useMenuItemActions({ state, itemIdSource });
  return {
    pageChoices, copyHtmlEmbed, copyFeedback: state.copyFeedback, isNew, menu, title, setTitle: fields.changeTitle, slug,
    setSlug: fields.changeSlug, items, mode, changeMode: fields.changeMode, html, setHtml: state.setHtml, message: state.message,
    error: state.error, loading: state.loading, confirmLeave, ...tree, save, saving, t,
  };
}
