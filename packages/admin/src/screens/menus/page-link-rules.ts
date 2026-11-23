import type { AdminMenuItem, AdminMenuTarget } from "./api/menus-api.types.js";
export interface MenuPageChoice { id: string; title: string; status: "draft" | "published"; publicPath?: string; }
/** Release compatibility: installed DTO types predate the optional JSON content-type hint. */
export type PageMenuTarget = AdminMenuTarget & { entryType?: string; lastKnownHref?: string };
export type MenuTargetEditorKind = AdminMenuTarget["kind"] | "page";

export function menuTargetEditorKind({ target, pages }: { target: PageMenuTarget; pages?: readonly MenuPageChoice[] | undefined }, _optional = {}): MenuTargetEditorKind {
  if (target.kind !== "entryRef") return target.kind;
  const untypedPage = target.entryType === undefined && pages?.some((page) => page.id === target.entryId);
  return target.entryType === "page" || untypedPage ? "page" : target.kind;
}

export function hasPageLinks({ items }: { items: readonly AdminMenuItem[] }, _optional = {}): boolean {
  // Legacy refs need the catalogue before their editor kind is known; waiting for the hint
  // first prevented the Page picker from ever recovering a migrated unhinted reference.
  return items.some((item) => {
    const target: PageMenuTarget = item.target;
    return (target.kind === "entryRef" && (target.entryType === undefined || target.entryType === "page")) ||
      hasPageLinks({ items: item.children ?? [] });
  });
}

export function pageTargetForChoice(
  { entryId, pages, previous }: { entryId: string; pages?: readonly MenuPageChoice[] | undefined; previous?: PageMenuTarget | undefined },
  _optional = {},
): PageMenuTarget {
  const lastKnownHref = pages?.find((page) => page.id === entryId)?.publicPath ??
    (previous?.entryId === entryId ? previous.lastKnownHref : undefined);
  return { kind: "entryRef", entryId, entryType: "page", ...(lastKnownHref ? { lastKnownHref } : {}) };
}

/** Refresh the URL snapshot on every save, including unchanged/nested legacy page refs.
 * A failed catalogue read retains existing metadata; it never guesses a path from a label/id. */
export function pageItemsForSave(
  { items, pages }: { items: readonly AdminMenuItem[]; pages?: readonly MenuPageChoice[] | undefined },
  _optional = {},
): AdminMenuItem[] {
  return items.map((item) => ({ ...item,
    target: menuTargetEditorKind({ target: item.target, pages }) === "page"
      ? pageTargetForChoice({ entryId: item.target.entryId ?? "", pages, previous: item.target }) : item.target,
    ...(item.children ? { children: pageItemsForSave({ items: item.children, pages }) } : {}),
  }));
}

/** The scalar fallbacks are named for the same cyclomatic-complexity reason as MenuEditor's
 * orEmpty helper. Target reshaping belongs in rules, outside the editor's markup. */
function orEmpty({ value }: { value: string | undefined }, _optional = {}): string { return value ?? ""; }

const TARGET_FOR_KIND: Record<MenuTargetEditorKind, (required: { prev: PageMenuTarget }, optional?: Record<string, never>) => PageMenuTarget> = {
  page: ({ prev }, _optional = {}) => {
    const lastKnownHref = prev.lastKnownHref || prev.href;
    return { kind: "entryRef", entryId: orEmpty({ value: prev.entryId }), entryType: "page",
      ...(lastKnownHref ? { lastKnownHref } : {}) };
  },
  url: ({ prev }, _optional = {}) => ({ kind: "url", href: orEmpty({ value: prev.href }) }),
  route: ({ prev }, _optional = {}) => ({ kind: "route", route: orEmpty({ value: prev.route }) }),
  entryRef: ({ prev }, _optional = {}) => ({ kind: "entryRef", entryId: orEmpty({ value: prev.entryId }) }),
  termRef: ({ prev }, _optional = {}) => ({ kind: "termRef", termId: orEmpty({ value: prev.termId }), taxonomy: orEmpty({ value: prev.taxonomy }) }),
};

export function targetForKind(
  { kind, prev }: { kind: MenuTargetEditorKind; prev: PageMenuTarget },
  _optional = {},
): PageMenuTarget {
  return TARGET_FOR_KIND[kind]({ prev });
}

function isUnavailablePageSelection(
  { entryId, pages, selected }: { entryId?: string | undefined; pages?: readonly MenuPageChoice[] | undefined; selected?: MenuPageChoice | undefined },
  _optional = {},
): boolean {
  return Boolean(entryId && pages && (!selected || selected.status !== "published"));
}

export function pageLinkState(
  { entryId, label, pages, t }: { entryId?: string | undefined; label?: string | undefined; pages?: readonly MenuPageChoice[] | undefined; t: (key: string) => string },
  _optional = {},
) {
  const selected = pages?.find((page) => page.id === entryId);
  const unavailable = isUnavailablePageSelection({ entryId, pages, selected });
  return {
    value: entryId ?? "",
    unavailable,
    choices: [
      { id: "", title: t("Choose a page…") },
      ...(entryId && !selected ? [{ id: entryId, title: label || t("Page not published") }] : []),
      ...(pages ?? []),
    ],
  };
}
