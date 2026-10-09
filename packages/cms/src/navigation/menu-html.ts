/**
 * @file HTML mode for a menu (2026-10-08): the author writes the menu's markup by hand instead of
 * building an item tree, so it can be styled however they want.
 *
 * Same trust model as HTML-mode forms (`forms/html/html-authoring.ts`) and HTML Pages: the markup is
 * admin/owner-trusted and NOT sanitized. Hosts gate it behind their raw-HTML permission (Tovu binds
 * `pages.edit_html`, the one forms use); this module only validates and normalizes. parse5 balances
 * the fragment so a stray `</nav>` or an unclosed `<div>` cannot close or swallow the theme element
 * the menu renders inside.
 *
 * Both modes' data live side by side in the doc: switching mode never deletes the other one, so an
 * author can flip back and find their items (or their HTML) still there.
 */
import { parseFragment, serialize } from "parse5";
import type { NavMenuDoc, NavMenuMode } from "./types.js";

/** Same ceiling HTML-mode forms use. */
export const MAX_MENU_HTML_LENGTH = 200_000;

/** The optional HTML-mode fields a create/update write may carry. */
export interface MenuHtmlAuthoring {
  mode?: NavMenuMode | undefined;
  html?: string | undefined;
}

/**
 * Whether a write authors raw HTML, and so needs the host's raw-HTML permission. Switching back to
 * items without sending markup does not author anything (forms apply the same rule to "builder").
 * @complexity O(1).
 */
export function isMenuHtmlAuthoring({ mode, html }: MenuHtmlAuthoring, _optional: Record<string, never> = {}): boolean {
  return html !== undefined || mode === "html";
}

/** Balance the fragment; scripts and authored styling stay as written (trusted markup). */
function normalizeMenuHtml(html: string): string {
  return serialize(parseFragment(html));
}

/**
 * Why a write's `mode`/`html` is invalid, or `null` when it is fine. A message rather than a throw so
 * `menu-service.ts` raises its own `MenuValidationError` without this file importing it back.
 * @complexity O(1).
 */
export function menuHtmlInputProblem({ mode, html }: MenuHtmlAuthoring, _optional: Record<string, never> = {}): string | null {
  if (mode !== undefined && mode !== "items" && mode !== "html") return "mode must be 'items' or 'html'";
  if (html !== undefined && (typeof html !== "string" || html.length > MAX_MENU_HTML_LENGTH)) {
    return `html must be a string of at most ${MAX_MENU_HTML_LENGTH} characters`;
  }
  return null;
}

/**
 * The doc's `mode`/`html` after a valid write: submitted values win, omitted ones keep what is
 * stored, and a menu that never used HTML mode gets neither key, so its stored doc (and publish
 * hash) is unchanged. Call {@link menuHtmlInputProblem} first.
 * @complexity O(h) in the submitted html length (one parse + serialize).
 */
export function mergeMenuHtml(
  { input, existing }: { input: MenuHtmlAuthoring; existing?: Pick<NavMenuDoc, "mode" | "html"> | undefined },
  _optional: Record<string, never> = {},
): Pick<NavMenuDoc, "mode" | "html"> {
  const mode = input.mode ?? existing?.mode;
  const html = input.html !== undefined ? normalizeMenuHtml(input.html) : existing?.html;
  return { ...(mode !== undefined ? { mode } : {}), ...(html !== undefined ? { html } : {}) };
}
