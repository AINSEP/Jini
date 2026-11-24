import { type MenuItemFieldProps, MenuItemAttrsFields, MenuItemTargetFields } from "./MenuItemFields.js";
import type { useMenuItemRemove } from "./MenuEditor.hooks.js";
import { MenuPageLinkFields } from "./MenuPageLinkFields.js";
import type { useMenuPageLinkFields, useMenuTargetEditor } from "./MenuPageLinkFields.hooks.js";
import type { MenuPageChoice } from "./page-link-rules.js";

/**
 * @file One row of the menu tree (`ItemRow`) and the pieces it is built from. Every custom hook the
 * row calls reaches it as the REQUIRED {@link MenuItemRowHooks} prop — the host passes this
 * package's `useMenuItemRemove`, `useMenuTargetEditor` and `useMenuPageLinkFields` (or test doubles).
 */

/** The custom hooks a menu item row calls; required so the row imports none of them. */
export interface MenuItemRowHooks {
  useMenuItemRemove: typeof useMenuItemRemove;
  useMenuTargetEditor: typeof useMenuTargetEditor;
  useMenuPageLinkFields: typeof useMenuPageLinkFields;
}

export interface MenuItemRowProps extends MenuItemFieldProps {
  pages?: readonly MenuPageChoice[] | undefined;
  onRemove: (path: number[]) => void;
  onAddChild: (path: number[]) => void;
  onMove: (path: number[], direction: -1 | 1) => void;
  hooks: MenuItemRowHooks;
}

/** The label input, the link-type select and the target fields. */
function ItemRowFields({ item, path, onChange, t, pages, hooks }: Pick<MenuItemRowProps, "item" | "path" | "onChange" | "t" | "pages" | "hooks">) {
  const targetController = hooks.useMenuTargetEditor({ item, path, onChange, pages });
  return (
    <>
      {/* Audit finding: every control below was placeholder-only (or, for the `<select>`, had no
          accessible name at all — no placeholder, no label, nothing). Each now wraps in a real
          `<label>` with a `.jini-visually-hidden` name, same fix and same reasoning as the title/slug
          fields — the host's label-wrap rule costs no layout in this dense flex row. */}
      <label className="jini-a11y-label-wrap">
        <span className="jini-visually-hidden">{t("Item label")}</span>
        <input
          value={item.label ?? ""}
          placeholder={t("Label")}
          onChange={(e) => onChange(path, (it) => ({ ...it, label: e.target.value }))}
        />
      </label>
      <label className="jini-a11y-label-wrap">
        <span className="jini-visually-hidden">{t("Link type")}</span>
        <select value={targetController.kind} onChange={targetController.selectType}>
          <option value="url">{t("URL")}</option>
          <option value="route">{t("Route")}</option>
          <option value="page">{t("Page")}</option>
          <option value="entryRef">{t("Entry")}</option>
          <option value="termRef">{t("Term")}</option>
        </select>
      </label>
      {targetController.isPage
        ? <MenuPageLinkFields item={item} path={path} pages={pages} onChange={onChange} t={t} useMenuPageLinkFields={hooks.useMenuPageLinkFields} />
        : <MenuItemTargetFields item={item} path={path} onChange={onChange} t={t} />}
    </>
  );
}

/** Move up/down, add child and Remove. */
function ItemRowButtons({ item, path, onRemove, onAddChild, onMove, t, hooks }: Pick<MenuItemRowProps, "item" | "path" | "onRemove" | "onAddChild" | "onMove" | "t" | "hooks">) {
  const { handleRemoveClick } = hooks.useMenuItemRemove({ item: item, path: path, onRemove: onRemove });
  return (
    <>
      {/* `aria-label` alongside `title`: `title` alone isn't reliably exposed to assistive tech
          and isn't keyboard-discoverable without a mouse hover (audit Minor finding). */}
      <button className="jini-tb-btn" onClick={() => onMove(path, -1)} title={t("Move up")} aria-label={t("Move item up")}>
        ↑
      </button>
      <button className="jini-tb-btn" onClick={() => onMove(path, 1)} title={t("Move down")} aria-label={t("Move item down")}>
        ↓
      </button>
      <button className="jini-tb-btn" onClick={() => onAddChild(path)} title={t("Add child item")}>
        {t("+ child")}
      </button>
      <button
        className="jini-tb-btn"
        // Audit Major finding: Remove previously deleted the clicked item's entire subtree in
        // one click, no confirmation, no indication children existed — hits hardest for a
        // screen-reader user, since the same indentation a sighted operator reads "this has
        // children" from (`marginLeft: path.length * 20`) carries no structural signal
        // for them either. A leaf item (no children) stays a bare click, matching this screen's
        // own `FormFieldsEditor`-sibling "Remove" convention for low-stakes removals — see
        // `MenuEditor.hooks.tsx`'s `useMenuItemRemove` for the confirmation logic itself.
        onClick={handleRemoveClick}
        title={t("Remove item")}
        // `✕` is this button's only text content, so — unlike Move up/down above, whose glyphs
        // are at least paired with a real word via `title` alone being insufficient too — its
        // accessible name would otherwise compute to the glyph itself ("✕"/"multiplication
        // sign"), not "Remove item". Found empirically while adding this button's test:
        // `title` is never part of the accessible-name computation when text content exists.
        aria-label={t("Remove item")}
      >
        ✕
      </button>
    </>
  );
}

export function ItemRow(props: MenuItemRowProps) {
  const { item, path, onChange, t } = props;
  return (
    <div className="jini-menu-item-row" style={{ marginLeft: path.length * 20 }}>
      <div className="jini-menu-item-fields">
        <ItemRowFields {...props} />
        <ItemRowButtons {...props} />
      </div>
      <MenuItemAttrsFields item={item} path={path} onChange={onChange} t={t} />
      {(item.children ?? []).map((child, i) => (
        <ItemRow {...props} key={child.id} item={child} path={[...path, i]} />
      ))}
    </div>
  );
}
