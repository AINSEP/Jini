import type { AdminMenuItem } from "./api/menus-api.types.js";
import type { MenuPageChoice } from "./page-link-rules.js";
import type { useMenuPageLinkFields } from "./MenuPageLinkFields.hooks.js";

/**
 * Existing entryRef transport stores the stable page id; the public resolver owns its URL.
 * Classes are `jini-menu-page-link-*`; the host styles them (aliases of its label-wrap,
 * visually-hidden and muted-cell rules).
 * @example <MenuPageLinkFields item={item} path={path} pages={pages} onChange={onChange} t={t} useMenuPageLinkFields={useMenuPageLinkFields} />
 */
export function MenuPageLinkFields({ item, path, pages, onChange, t, useMenuPageLinkFields: useMenuPageLinkFieldsHook }: {
  item: AdminMenuItem; path: number[]; pages?: readonly MenuPageChoice[] | undefined; t: (key: string) => string;
  onChange: (path: number[], update: (item: AdminMenuItem) => AdminMenuItem) => void;
  /** The page-link state hook; the host injects `useMenuPageLinkFields` (or a test double). */
  useMenuPageLinkFields: typeof useMenuPageLinkFields;
}) {
  const state = useMenuPageLinkFieldsHook({ item, path, pages, onChange, t });
  return <>
    <label className="jini-menu-page-link-label">
      <span className="jini-menu-page-link-visually-hidden">{t("Page")}</span>
      <select aria-label={t("Page")} value={state.value}
        onChange={state.selectPage}>
        {state.choices.map((page) => <option key={page.id} value={page.id}>{page.title}</option>)}
      </select>
    </label>
    {state.unavailable ? <span className="jini-menu-page-link-unavailable" role="status">{t("Page not published")}</span> : null}
  </>;
}
