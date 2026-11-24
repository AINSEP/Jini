import { useRef, useState } from "react";
import type { AdminMenu, AdminMenuItem, AdminMenuMode } from "../api/menus-api.types.js";
import { menuHtmlStarter } from "../html-rules.js";
import { pageItemsForSave, type MenuPageChoice } from "../page-link-rules.js";
import type { MenusHostKit } from "../menus-host-kit.js";
import { addChildAtPath, mapAtPath, moveAtPath, newItem, removeAtPath, type MenuItemIdSource } from "./menu-tree.js";

/**
 * @file The menu editor's working copy: every piece of `useState`/`useRef` state `useMenuEditor`
 * owns, the shared hydrate step its load effect applies, and the field/tree setters built over that
 * state. Split out of `use-menu-editor.hooks.ts` behaviour-identically (same state, same initial
 * values, same transitions) so each hook stays small.
 */

/** What `useDirtyGuard` compares — everything an operator can actually edit on this screen. */
export interface MenuFormState {
  title: string;
  slug: string;
  items: AdminMenuItem[];
  mode: AdminMenuMode;
  html: string;
}

/** The editor's state cells; `isNew` starts `loading` false (nothing to load). */
export function useMenuEditorState({ isNew }: { isNew: boolean }, _optional = {}) {
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [menu, setMenu] = useState<AdminMenu | null>(null);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  // A cleared slug is still an explicit edit. Track intent rather than testing whether it is empty.
  const slugEdited = useRef(false);
  const [items, setItems] = useState<AdminMenuItem[]>([]);
  const [mode, setMode] = useState<AdminMenuMode>("items");
  const [html, setHtml] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!isNew);
  // Snapshot of the last loaded-or-saved state (audit finding: no editor screen tracks this at
  // all today, so there is nothing for a dirty check to compare against). `null` only while a load
  // is still in flight — set immediately for `isNew` (an empty menu IS the loaded state to diff
  // against), and refreshed after every successful save so a saved edit stops reading as dirty.
  const [original, setOriginal] = useState<MenuFormState | null>(null);
  return {
    copyFeedback, setCopyFeedback, menu, setMenu, title, setTitle, slug, setSlug, slugEdited, items, setItems,
    mode, setMode, html, setHtml, message, setMessage, error, setError, loading, setLoading, original, setOriginal,
  };
}

export type MenuEditorState = ReturnType<typeof useMenuEditorState>;

/** Puts one loaded menu (or, for `null`, the blank create-mode menu) into the form and its baseline. */
export function hydrateMenuForm({ state, menu }: { state: MenuEditorState; menu: AdminMenu | null }, _optional = {}): void {
  const form: MenuFormState = menu === null
    ? { title: "", slug: "", items: [], mode: "items", html: "" }
    : { title: menu.title, slug: menu.slug, items: menu.items, mode: menu.mode ?? "items", html: menu.html ?? "" };
  state.setMenu(menu);
  state.setTitle(form.title);
  state.setSlug(form.slug);
  state.setItems(form.items);
  state.setMode(form.mode);
  state.setHtml(form.html);
  state.setOriginal({ ...form });
}

/** Title/slug/mode setters: title derives the slug for a new menu until the slug is edited. */
export function useMenuFieldActions(
  { state, isNew, kit, pageChoices }: { state: MenuEditorState; isNew: boolean; kit: MenusHostKit; pageChoices: MenuPageChoice[] | undefined },
  _optional = {},
) {
  const { setTitle, setSlug, slugEdited, html, setHtml, items, setMode } = state;
  /** New-menu titles derive through the same browser-safe slug owner as pages/forms; persisted URLs stay stable. */
  function changeTitle({ next }: { next: string }, _optional = {}): void {
    setTitle(next);
    if (isNew && !slugEdited.current) setSlug(kit.toSlug({ text: next }));
  }

  /** Any explicit slug edit ends automatic derivation for this menu, including an intentionally empty value. */
  function changeSlug({ next }: { next: string }, _optional = {}): void {
    slugEdited.current = true;
    setSlug(next);
  }

  function changeMode(next: AdminMenuMode) {
    // `pageItemsForSave` fills each page link's public path from the catalogue, so the starter
    // links to real URLs rather than `#`.
    if (next === "html" && html === "") setHtml(menuHtmlStarter({ items: pageItemsForSave({ items, pages: pageChoices }) }));
    setMode(next);
  }
  return { changeTitle, changeSlug, changeMode };
}

/** The tree setters, each an immutable rebuild of `items` through `menu-tree.ts`. */
export function useMenuItemActions({ state, itemIdSource }: { state: MenuEditorState; itemIdSource: MenuItemIdSource }, _optional = {}) {
  const { setItems } = state;
  function changeAt({ path, fn }: { path: number[]; fn: (item: AdminMenuItem) => AdminMenuItem }, _optional = {}) {
    setItems((prev) => mapAtPath({ items: prev, path: path, fn: fn }));
  }
  function removeAt({ path }: { path: number[] }, _optional = {}) {
    setItems((prev) => removeAtPath({ items: prev, path: path }));
  }
  function addChildAt({ path }: { path: number[] }, _optional = {}) {
    setItems((prev) => addChildAtPath({ items: prev, path: path, createItem: () => newItem({ source: itemIdSource }) }));
  }
  function moveAt({ path, direction }: { path: number[]; direction: -1 | 1 }, _optional = {}) {
    setItems((prev) => moveAtPath({ items: prev, path: path, direction: direction }));
  }
  function addRootItem() {
    setItems((prev) => [...prev, newItem({ source: itemIdSource })]);
  }
  return { changeAt, removeAt, addChildAt, moveAt, addRootItem };
}
