import { useRef, useState, type MutableRefObject } from "react";
import type { Translate } from "@jini-ai/core/text";
import { useFetchMutation } from "../../../react/kit.js";
import type { AdminMenu } from "../api/menus-api.types.js";
import { menuAuthoringForSave, menuHtmlEmbed } from "../html-rules.js";
import type { MenusHostKit } from "../menus-host-kit.js";
import { pageItemsForSave, type MenuPageChoice } from "../page-link-rules.js";
import type { MenusPort } from "./menus-port.hooks.js";
import type { MenuEditorState } from "./use-menu-editor-state.hooks.js";

/**
 * @file The menu editor's two outward actions — Copy HTML embed and Save — split out of
 * `use-menu-editor.hooks.ts` behaviour-identically (same guards, same order, same copy).
 */

/** The browser clipboard slice Copy HTML embed writes through. */
export interface MenuEditorClipboard { writeText: (text: string) => Promise<void> }

function menuSaveError({ error, t, kit }: { error: unknown; t: Translate; kit: MenusHostKit }, _optional = {}): string {
  // A lost compare-and-set (`409 VERSION_CONFLICT`, real since menu saves became
  // compare-and-set, wm S4) gets translated "someone else changed this" copy instead of the
  // server's "menu '<id>' was modified concurrently…" text. Other errors (a slug already taken
  // is also a 409, without the code) keep the server message.
  if (kit.isVersionConflict({ error })) return t(kit.versionConflictMessage);
  return error instanceof Error ? error.message : "save failed";
}

/** Copies the menu's embed snippet; feedback only lands while the same menu is still on screen. */
export function useMenuCopyEmbed(
  { state, menuId, activeMenuIdRef, clipboard, t, kit }: {
    state: MenuEditorState; menuId: string | null; activeMenuIdRef: MutableRefObject<string | null>;
    clipboard: MenuEditorClipboard | undefined; t: Translate; kit: MenusHostKit;
  },
  _optional = {},
): () => Promise<void> {
  const { menu, setCopyFeedback } = state;
  return async function copyHtmlEmbed() {
    if (!menu) return;
    const copyingForMenuId = menuId;
    const failureGeneration = kit.failures.getGeneration();
    try {
      await (clipboard ?? navigator.clipboard).writeText(menuHtmlEmbed({ slug: menu.slug }));
      if (activeMenuIdRef.current === copyingForMenuId) setCopyFeedback(t("Copied!"));
    } catch (error) {
      if (activeMenuIdRef.current !== copyingForMenuId) return;
      setCopyFeedback(t("Could not copy embed"));
      if (kit.failures.isClipboardRefusal({ error })) return;
      kit.failures.publishLocal({
        message: "The menu embed code could not be copied.",
        action: "Try Copy HTML embed again. If it keeps failing, copy details and report this problem.",
        step: "Copy menu embed code",
        cause: error,
      }, { generation: failureGeneration });
    }
  };
}

/** Commits one successful update to the form, unless the operator already left that menu. */
function commitSavedMenu({ state, saved }: { state: MenuEditorState; saved: AdminMenu }, _optional = {}): void {
  const { title, slug, mode, html } = state;
  state.setMenu(saved);
  state.setItems(saved.items);
  // The server stores HTML parse5-balanced, so show (and baseline on) what it actually kept.
  const savedHtml = saved.html ?? html;
  state.setHtml(savedHtml);
  // A saved edit is no longer "unsaved" — re-baseline what the dirty check compares against,
  // or the guard would keep firing for a change the operator just persisted.
  state.setOriginal({ title, slug, items: saved.items, mode, html: savedHtml });
  state.setMessage(`Saved · version ${saved.version}`);
}

interface MenuSaveArgs {
  state: MenuEditorState; menuId: string | null; isNew: boolean; activeMenuIdRef: MutableRefObject<string | null>;
  port: MenusPort; navigate: (path: string, options?: { replace?: boolean }) => void; t: Translate; kit: MenusHostKit;
  pageChoices: MenuPageChoice[] | undefined;
}

/** Save (create or compare-and-set update) behind a same-tick re-entry guard. */
export function useMenuSave({ state, menuId, isNew, activeMenuIdRef, port, navigate, t, kit, pageChoices }: MenuSaveArgs, _optional = {}) {
  const { menu, title, slug, items, mode, html, setMessage, setError } = state;
  const write = useFetchMutation({ run: ({ input }: { input: () => Promise<unknown> }) => input() }, { invalidates: [["menus"]] });
  // Same-tick re-entry guard for `save()` (S4a, 2026-09-20) — see `MenuEditorController.saving`'s
  // own doc for the double-write bug this closes. A plain `useRef`, not `useSettlementGeneration`
  // (Pages/Posts' primitive): this screen has only one write action, so there is no "later click
  // wins" outcome to preserve — the second same-tick call should simply not happen at all. Checked
  // synchronously at the top of `save()`, before anything else runs, so two calls issued in the same
  // tick (a double click) both observe the first one's claim.
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);

  async function save() {
    // Drop a same-tick duplicate outright — see `savingRef`'s own comment above and
    // `MenuEditorController.saving`'s doc for why this screen prefers "the second click never
    // happens" over Pages/Posts' "let the later one win".
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    const savingForMenuId = menuId;
    setMessage(null);
    setError(null);
    try {
      const saveItems = pageItemsForSave({ items, pages: pageChoices });
      const authoring = menuAuthoringForSave({ mode, html, storedMode: menu?.mode });
      if (isNew) {
        const { menu: created } = await write.mutate({ input: () => port.createMenu({ input: { title, slug }, options: { items: saveItems, ...authoring } }) }) as Awaited<ReturnType<typeof port.createMenu>>;
        navigate(`/menus/${created.slug}`);
        return;
      }
      if (!menu) return;
      const savingMenu = menu;
      const { menu: saved } = await write.mutate({ input: () => port.updateMenuTree({
        target: { id: savingMenu.id, expectedVersion: savingMenu.version, items: saveItems },
        options: { title, slug, ...authoring },
      }) }) as Awaited<ReturnType<typeof port.updateMenuTree>>;
      if (activeMenuIdRef.current !== savingForMenuId) return;
      commitSavedMenu({ state, saved });
    } catch (e) {
      if (activeMenuIdRef.current !== savingForMenuId) return;
      setError(menuSaveError({ error: e, t, kit }));
    } finally {
      // Unconditional, unlike the `activeMenuIdRef` checks above: this flag tracks whether THIS
      // save cycle is still on the wire, not whether its result still belongs to the menu on
      // screen, so it always clears when the request settles, whichever menu that request was for.
      savingRef.current = false;
      setSaving(false);
    }
  }
  return { save, saving };
}
