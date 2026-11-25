import { agentHandle } from "@jini-ai/core/agent-handles";
import type { MenuEditorController } from "./hooks/use-menu-editor.hooks.js";

/**
 * @file The menu editor's header — back link, title block and the Copy/Save actions — shared by both
 * authoring modes. The back link's target is the host's list route, passed as `menusHref`.
 */

export type MenuEditorHeaderState = Pick<MenuEditorController, "isNew" | "menu" | "copyHtmlEmbed" | "copyFeedback" | "message" | "save" | "saving" | "confirmLeave" | "t" | "leaveGuardOwner">;

/** The back link, guarded by the dirty check. */
function MenuEditorBackLink({ menusHref, confirmLeave, t, leaveGuardOwner }: { menusHref: string } & Pick<MenuEditorHeaderState, "confirmLeave" | "t" | "leaveGuardOwner">) {
  return (
    <div className="jini-page-header-lead">
      {/* Audit finding: no editor screen warns before an in-app navigation discards unsaved
          edits — confirmed live on this exact screen. The header guards Back as a fallback when
          the router does not own the dirty check; router ownership skips this call so each Back
          click has only one confirmation owner. `preventDefault()` here stops
          the host router's document-level click interceptor from firing `navigate()`, since that
          listener's first check is `event.defaultPrevented`.
          Plain `<a className="jini-btn-secondary">`, not a `<button>` nested inside an `<a>`
          (invalid HTML) — same fix Pages/Posts/Forms' own back links already made; this one
          still carried the old nested-button markup.

          Visible label shortened to a plain "← Back" (owner, 2026-09-22 — every editor's back
          button reads the same short way now). `aria-label` keeps "Back: Menus" — colon-joined
          rather than concatenated into a sentence so it needs no new per-locale phrase key and
          still starts with the exact visible text (WCAG 2.5.3 Label in Name). */}
      <a
        className="jini-btn-secondary"
        href={menusHref}
        onClick={(e) => {
          if (leaveGuardOwner !== "router" && !confirmLeave()) e.preventDefault();
        }}
        aria-label={`${t("Back")}: ${t("Menus")}`}
        {...agentHandle({ handle: "menu-editor-back" }, { role: "link", label: "Back to the list of all menus" })}
      >
        ← {t("Back")}
      </a>
    </div>
  );
}

/** Copy HTML embed, its feedback, the saved message and Save. */
function MenuEditorActions({ menu, copyHtmlEmbed, copyFeedback, message, save, saving, t }: Omit<MenuEditorHeaderState, "isNew" | "confirmLeave">) {
  return (
    <div
      className="jini-page-header-actions jini-page-actions"
      {...agentHandle({ handle: "menu-editor-actions" }, { role: "region", label: "Save status and the Save button" })}
    >
      {menu ? <button type="button" className="jini-btn-secondary" onClick={copyHtmlEmbed} {...agentHandle({ handle: "menu-editor-copy-html-embed" }, { role: "button", label: "Copy this menu's HTML embed" })}>{t("Copy HTML embed")}</button> : null}
      {copyFeedback ? <span role="status">{copyFeedback}</span> : null}
      {message ? <span className="jini-save-ok">{message}</span> : null}
      <button onClick={save} disabled={saving} {...agentHandle({ handle: "menu-editor-save" }, { role: "button", label: "Save this menu" })}>
        {t("Save")}
      </button>
    </div>
  );
}

/** The menu's navigation and save controls share one header in both authoring modes. */
export function MenuEditorHeader({ editor, menusHref }: { editor: MenuEditorHeaderState; menusHref: string }) {
  const { isNew, confirmLeave, t, leaveGuardOwner } = editor;
  /* `jini-page-header-split` — same shared idiom Pages/Posts/Forms already use:
        back link alone at the left rail, title block centred. Menus (like Widgets) never grew a
        separate `.editor-action-row` below a toolbar, so Save/status stay IN the header instead
        of an empty third rail — the actions rail is pinned to the
        right and gets its own narrow-container stacking row alongside the back link (owner,
        2026-09-22: "put the back button on the left, like the other editors" — this used to be a
        plain `.page-header`/`.page-actions` row with Back and Save both crowded at the right). */
  return (
    <div
      className="jini-page-header jini-page-header-split"
      {...agentHandle({ handle: "menu-editor-header" }, {
        role: "region",
        label: "Menu editor header — the back link, the menu's title, and the Save button",
      })}
    >
      <MenuEditorBackLink menusHref={menusHref} confirmLeave={confirmLeave} t={t} {...(leaveGuardOwner === undefined ? {} : { leaveGuardOwner })} />
      <div className="jini-page-header-text">
        <p className="jini-page-kicker">{t("Content")}</p>
        <h1 className="jini-page-title">{t(isNew ? "New menu" : "Edit menu")}</h1>
        <p className="jini-page-description">{t("Build this menu's items and where each one links to.")}</p>
      </div>
      <MenuEditorActions {...editor} />
    </div>
  );
}
