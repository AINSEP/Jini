import type { JsonObject, JsonValue } from "@jini-ai/core/primitives";
import { escapeHtml } from "@jini-ai/core/text";
import { isNonArrayRecord } from "@jini-ai/core/records";
import { toAllowedHref } from "./href.js";

/** The `class="…"` attribute from a resolved item's `attrs.cssClass`, or `""` when absent — same
 *  escaped, no-allowlist posture `static-render.ts`'s tree-variant renderer already established for
 *  the same `NavItemAttrs` passthrough (see that file's `menuItemClasses`). */
function widgetMenuItemClassAttr({ attrs }: { attrs: JsonObject | undefined }, _optional = {}): string {
  const cssClass = attrs?.cssClass;
  return typeof cssClass === "string" && cssClass ? ` class="${escapeHtml({ text: cssClass })}"` : "";
}

/** `rel="…"`/`target="_blank"` from a resolved item's `attrs.rel`/`attrs.openInNewTab`. */
function widgetMenuItemLinkAttrs({ attrs }: { attrs: JsonObject | undefined }, _optional = {}): string {
  const rel = attrs?.rel;
  const openInNewTab = attrs?.openInNewTab === true;
  const relAttr = menuLinkRelAttr({ rel: typeof rel === "string" ? rel : undefined, openInNewTab });
  const targetAttr = openInNewTab ? ' target="_blank"' : "";
  return `${relAttr}${targetAttr}`;
}

/** `icon`/`description` as child spans around the label — mirrors `static-render.ts`'s
 *  `menuItemBody` so a theme author moving between static and widget-IR themes gets the same
 *  markup shape for the same authored attrs. */
function widgetMenuItemDecoratedLabel({ attrs, label }: { attrs: JsonObject | undefined; label: string }, _optional = {}): string {
  const icon = attrs?.icon;
  const iconHtml =
    typeof icon === "string" && icon ? `<span class="widget-menu-item-icon" data-icon="${escapeHtml({ text: icon })}"></span>` : "";
  const description = attrs?.description;
  const descriptionHtml =
    typeof description === "string" && description
      ? `<span class="widget-menu-item-desc">${escapeHtml({ text: description })}</span>`
      : "";
  return `${iconHtml}${label}${descriptionHtml}`;
}

/** Renders a `menu` widget's resolved nav items (`navigation/resolver.ts`'s `ResolvedNavItem[]`,
 * passed through as plain IR props) — mirrors `siteNav`'s own unavailable-link handling: an
 * `available:false` item renders as inert text, never a broken/empty href.
 *
 * `attrs` (`cssClass`/`rel`/`openInNewTab`/`icon`/`description`) previously reached this function
 * (the resolver already attaches `NavItemAttrs` to every `ResolvedNavItem`) but were read nowhere —
 * this was the one render path of the two that honored NONE of them, while the static-tier tree
 * renderer already honored `cssClass`/`icon`/`description`. Now both paths honor all five. */
function renderWidgetMenuItems({ items }: { items: JsonValue[] }, _optional = {}): string {
  return items
    .map((item) => {
      const o = obj({ value: item });
      if (!o) return "";
      const attrs = obj({ value: o.attrs });
      const label = widgetMenuItemDecoratedLabel({ attrs, label: escapeHtml({ text: str({ value: o.label }) }) });
      const available = o.available === true && typeof o.href === "string";
      const link = available
        ? `<a href="${escapeHtml({ text: toAllowedHref({ rawHref: o.href }) })}"${widgetMenuItemLinkAttrs({ attrs })}>${label}</a>`
        : `<span class="widget-menu-item--unavailable">${label}</span>`;
      const children = arr({ value: o.children });
      const sub = children.length ? `<ul>${renderWidgetMenuItems({ items: children })}</ul>` : "";
      return `<li${widgetMenuItemClassAttr({ attrs })}>${link}${sub}</li>`;
    })
    .join("");
}

/**
 * Render the navigation-owned menu IR, escaping the title and item labels. HTML mode forwards
 * trusted markup already balanced by the navigation save path, just as static menu embeds do.
 * @complexity O(h) for HTML length, or O(n + text length) for the resolved item tree.
 */
export function renderWidgetMenu({ props }: { props: JsonObject }, _optional: Record<string, never> = {}): string {
  const title = str({ value: props.title });
  const heading = title ? `<h3 class="widget-menu-title">${escapeHtml({ text: title })}</h3>` : "";
  if (props.mode === "html") return `<nav class="widget widget-menu">${heading}${str({ value: props.html })}</nav>`;
  return `<nav class="widget widget-menu">${heading}<ul>${renderWidgetMenuItems({ items: arr({ value: props.items }) })}</ul></nav>`;
}

/**
 * The escaped ` rel="…"` attribute for a menu `<a>`, or `""`. A new-tab link always gets
 * `noopener noreferrer`, even when the item never went through the resolver (which also drops
 * non-standard tokens — `@jini-ai/cms` `navigation/link-rel.ts`). Shared by every menu
 * renderer (this file, `static-render.ts`, the widget menu in `site/render.ts`) so none of them
 * can ship `target="_blank"` without it again (bug 11-02 o4). O(length of rel).
 */
export function menuLinkRelAttr({ rel, openInNewTab }: { rel?: string | undefined; openInNewTab?: boolean | undefined }, _optional = {}): string {
  const relTokens = new Set((rel ?? "").split(/\s+/).filter(Boolean));
  if (openInNewTab) { relTokens.add("noopener"); relTokens.add("noreferrer"); }
  return relTokens.size ? ` rel="${escapeHtml({ text: [...relTokens].join(" ") })}"` : "";
}


function str({ value }: { value: JsonValue | undefined }, { fallback = "" }: { fallback?: string } = {}): string {
  return typeof value === "string" ? value : fallback;
}

function arr({ value }: { value: JsonValue | undefined }, _optional = {}): JsonValue[] {
  return Array.isArray(value) ? value : [];
}

function obj({ value }: { value: JsonValue | undefined }, _optional = {}): JsonObject | undefined {
  return isNonArrayRecord({ value }) ? value as JsonObject : undefined;
}
