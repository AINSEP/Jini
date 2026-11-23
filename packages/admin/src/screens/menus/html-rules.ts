import type { AdminMenuAuthoring, AdminMenuItem, AdminMenuMode } from "./api/menus-api.types.js";
import type { PageMenuTarget } from "./page-link-rules.js";

/** Same marker shape and attribute escaping as the forms Copy HTML embed control. */
export function menuHtmlEmbed({ slug }: { slug: string }, _optional = {}): string {
  const config = JSON.stringify({ type: "menu", id: slug, mode: "html" }).replace(/'/g, "&#39;");
  return `<div data-embed-config='${config}'></div>`;
}

function escapeHtml({ value }: { value: string }, _optional = {}): string {
  return value.replace(/[&<>"']/g, (char) => {
    const escaped = ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char];
    if (escaped === undefined) throw new Error(`menu HTML escape has no replacement for ${char}`);
    return escaped;
  });
}

/** Best href the admin knows without a server round-trip: a URL's own href, a page link's last
 *  known public path, else `#` for the author to fill in (routes and terms resolve server-side). */
function starterHref(item: AdminMenuItem): string {
  const target = item.target as PageMenuTarget;
  return target.href || target.lastKnownHref || "#";
}

function starterLink(item: AdminMenuItem): string {
  return `<a href="${escapeHtml({ value: starterHref(item) })}">${escapeHtml({ value: item.label ?? "" })}</a>`;
}

function starterTree({ items, depth }: { items: readonly AdminMenuItem[]; depth: number }, _optional = {}): string[] {
  const pad = "  ".repeat(depth * 2);
  const lines = [`${pad}<ul class="menu-list depth-${depth}">`];
  for (const item of items) {
    const children = item.children ?? [];
    const classes = `menu-item depth-${depth}${children.length > 0 ? " has-children" : ""}`;
    if (children.length === 0) {
      lines.push(`${pad}  <li class="${classes}">${starterLink(item)}</li>`);
      continue;
    }
    lines.push(`${pad}  <li class="${classes}">${starterLink(item)}`, ...starterTree({ items: children, depth: depth + 1 }), `${pad}  </li>`);
  }
  lines.push(`${pad}</ul>`);
  return lines;
}

/**
 * The HTML tab's first content, built from the current items — forms' `formHtmlStarter` rule.
 *
 * It copies the markup the site's own menu renderers emit (the host website's theme static
 * renderer), so the theme's nav CSS styles it exactly like the items menu (owner rule:
 * HTML mode inherits theme styling and only ADDS the author's own markup). A flat menu becomes bare
 * `<a>` links, because theme navs style direct `<a>` children of a flex container and a `<ul>`
 * wrapper would collapse them. A nested menu becomes the tree renderer's
 * `ul.menu-list > li.menu-item` shape with the same `depth-N`/`has-children` hooks.
 *
 * @complexity O(n) time and space over the item count (the server caps a tree at 500).
 */
export function menuHtmlStarter({ items }: { items: readonly AdminMenuItem[] }, _optional = {}): string {
  if (items.length === 0) return `<a href="/">Home</a>`;
  if (items.some((item) => (item.children ?? []).length > 0)) return starterTree({ items: items, depth: 0 }).join("\n");
  return items.map(starterLink).join("\n");
}

/**
 * The authoring fields a Save sends, forms' rule: HTML mode sends `mode` + `html`; items mode sends
 * an explicit `mode: "items"` only to switch a stored HTML menu back, and otherwise nothing, so an
 * items-only save never rewrites HTML it did not touch (the server keeps omitted fields).
 */
export function menuAuthoringForSave(
  { mode, html, storedMode }: { mode: AdminMenuMode; html: string; storedMode: AdminMenuMode | undefined },
  _optional = {}
): AdminMenuAuthoring {
  if (mode === "html") return { mode, html };
  return storedMode === "html" ? { mode: "items" } : {};
}
