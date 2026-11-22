import type { AdminMenuItem } from "./api/menus-api.types.js";
import type { MenuPageChoice } from "./page-link-rules.js";
import { useMenuPageLinkFields } from "./MenuPageLinkFields.hooks.js";

/** Existing entryRef transport stores the stable page id; the public resolver owns its URL. */
export function MenuPageLinkFields({ item, path, pages, onChange, t, useMenuPageLinkFields: useMenuPageLinkFieldsHook = useMenuPageLinkFields }: {
  item: AdminMenuItem; path: number[]; pages?: readonly MenuPageChoice[] | undefined; t: (key: string) => string;
  onChange: (path: number[], update: (item: AdminMenuItem) => AdminMenuItem) => void;
  useMenuPageLinkFields?: typeof useMenuPageLinkFields;
}) {
  const state = useMenuPageLinkFieldsHook({ item, path, pages, onChange, t });
  return <>
    <label className="a11y-label-wrap">
      <span className="visually-hidden">{t("Page")}</span>
      <select aria-label={t("Page")} value={state.value}
        onChange={state.selectPage}>
        {state.choices.map((page) => <option key={page.id} value={page.id}>{page.title}</option>)}
      </select>
    </label>
    {state.unavailable ? <span className="muted-cell" role="status">{t("Page not published")}</span> : null}
  </>;
}
