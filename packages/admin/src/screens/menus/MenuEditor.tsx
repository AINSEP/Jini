import { agentHandle } from "@jini-ai/core/agent-handles";
import type { Translate } from "@jini-ai/core/text";
import type { MenuEditorController } from "./hooks/use-menu-editor.hooks.js";
import { MenuEditorHeader } from "./MenuEditorHeader.js";
import { ItemRow, type MenuItemRowHooks } from "./MenuItemRow.js";
import { MenuModeTabs, type MenuTabStrip } from "./MenuModeTabs.js";

/**
 * @file Per-menu tree editor (ADR-029 whole-tree replace) — markup only.
 *
 * v1 scope: a simple recursive nested-list UI — each item shows its
 * label/target-kind/target-value with add-child/remove/reorder controls.
 * No drag-and-drop.
 *
 * Every piece of state and every API call lives in `hooks/use-menu-editor.hooks.ts`; see that
 * file's header for why. What stays in this folder's markup files is presentation only:
 * `MenuItemRow.tsx` (`ItemRow`), `MenuItemFields.tsx` (`MenuItemTargetFields`/`MenuItemAttrsFields`),
 * `MenuModeTabs.tsx` and `MenuEditorHeader.tsx`. Target reshaping lives in `page-link-rules.ts` and
 * `MenuPageLinkFields.hooks.ts`; `ItemRow`'s Remove-button confirmation logic (`countDescendants`
 * included) lives in the colocated `MenuEditor.hooks.tsx`.
 *
 * Every host collaborator is a REQUIRED prop: the wired controller hook, the tab-strip helpers, the
 * row hooks and the list route. Classes are `jini-*`; the host styles them (twins of its page,
 * editor-title and menu-item rules).
 */

export interface MenuEditorProps {
  menuId: string | null;
  /** The host's wired `useMenuEditor` (port, router, translator and `MenusHostKit` bound) — REQUIRED;
   *  tests pass a double. */
  useMenuEditorHook: (required: { menuId: string | null }) => MenuEditorController;
  /** The host's tab-strip keyboard helpers for the mode tabs — REQUIRED. */
  tabStrip: MenuTabStrip;
  /** The custom hooks each item row calls — REQUIRED; the host passes this package's. */
  rowHooks: MenuItemRowHooks;
  /** The host's list route the header's back link points at. */
  menusHref: string;
}

/** Title and slug share one row — PostEditor's title row (the host stacks it at narrow widths).
 *  Audit finding: both were placeholder-only, no `<label>` — same fix as `PostEditor.tsx`'s title/slug. */
function MenuTitleRow({ title, setTitle, slug, setSlug, t }: Pick<MenuEditorController, "title" | "setTitle" | "slug" | "setSlug" | "t">) {
  return (
    <div className="jini-editor-title-row">
      <label className="jini-a11y-label-wrap">
        <span className="jini-visually-hidden">{t("Menu title")}</span>
        <input
          className="jini-editor-title"
          value={title}
          onChange={(e) => setTitle({ next: e.target.value })}
          placeholder={t("Menu title")}
        />
      </label>
      <div className="jini-editor-slug">
        /{" "}
        <label className="jini-a11y-label-wrap">
          <span className="jini-visually-hidden">{t("Menu slug")}</span>
          <input value={slug} onChange={(e) => setSlug({ next: e.target.value })} placeholder="menu-slug" />
        </label>
        {/* The internal id used to be surfaced here as a read-only field (2026-08-09). Removed
            2026-08-11 alongside PostEditor's, and this one had the stronger case for going: a menu's
            id is minted by `idGen.newId()`, so it is random per install and a theme can never
            reference it — which is exactly why `ffc0f44` made theme menu markers resolve by SLUG
            first. Showing the id next to the slug invited an author to paste the one handle that
            provably cannot work in a shipped theme. */}
      </div>
    </div>
  );
}

/** HTML mode: the author's own markup, rendered inside the theme's menu element so theme
 *  CSS still applies — forms' HTML editor class and trust model (`pages.edit_html`). */
function MenuHtmlSource({ html, setHtml, t }: Pick<MenuEditorController, "html" | "setHtml" | "t">) {
  return (
    <textarea
      className="jini-page-html-source"
      value={html}
      onChange={(e) => setHtml(e.target.value)}
      spellCheck={false}
      aria-label={t("Menu HTML")}
      {...agentHandle({ handle: "menu-html-source" }, { role: "field", label: "This menu's raw HTML" })}
    />
  );
}

/** The recursive item tree plus the root "+ Add item" button. */
function MenuItemTree({ editor, rowHooks }: { editor: MenuEditorController; rowHooks: MenuItemRowHooks }) {
  const { items, pageChoices, changeAt, removeAt, addChildAt, moveAt, addRootItem, t } = editor;
  return (
    <div className="jini-menu-tree">
      {items.map((item, i) => (
        <ItemRow
          key={item.id}
          item={item}
          path={[i]}
          onChange={(path, fn) => changeAt({ path, fn })}
          onRemove={(path) => removeAt({ path })}
          onAddChild={(path) => addChildAt({ path })}
          onMove={(path, direction) => moveAt({ path, direction })}
          t={t as Translate}
          pages={pageChoices}
          hooks={rowHooks}
        />
      ))}
      {/* Secondary, not bare/primary — Save in the header is this screen's one primary action;
          an equally-loud "+ Add item" here would be the same two-primaries flatness problem
          the host's button-hierarchy comment describes for row actions, just at the
          page level instead of a table row. */}
      <button type="button" className="jini-btn-secondary" onClick={addRootItem}>
        {t("+ Add item")}
      </button>
    </div>
  );
}

export function MenuEditor({ menuId, useMenuEditorHook, tabStrip, rowHooks, menusHref }: MenuEditorProps) {
  const editor = useMenuEditorHook({ menuId });
  const { isNew, menu, title, setTitle, slug, setSlug, mode, changeMode, html, setHtml, error, loading, t } = editor;

  if (error && !isNew && !menu) return <div className="jini-notice jini-notice-error">{error}</div>;
  if (loading) return <div className="jini-notice">{t("Loading menu…")}</div>;

  return (
    <div className="jini-page">
      <MenuEditorHeader editor={editor} menusHref={menusHref} />
      {/* Forms' full-width notice keeps save refusals (permission, size cap, unbalanced markup)
          readable outside the narrow header rail in both authoring modes.
          Above the source, not below: the textarea is 512px tall, so an error under it sat
          below the fold at desktop height. */}
      {error ? <div className="jini-notice jini-notice-error" role="alert">{error}</div> : null}
      <MenuTitleRow title={title} setTitle={setTitle} slug={slug} setSlug={setSlug} t={t} />
      <MenuModeTabs mode={mode} onChange={changeMode} t={t} tabStrip={tabStrip} />
      {mode === "html" ? <MenuHtmlSource html={html} setHtml={setHtml} t={t} /> : <MenuItemTree editor={editor} rowHooks={rowHooks} />}
    </div>
  );
}
