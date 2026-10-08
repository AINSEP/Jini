import { agentHandle } from '@jini-ai/agentic';
import { useWiredFormEditor } from "../hooks/use-form-editor.hooks.js";
import { FormEditorFieldsBody } from "../components/FormEditorFieldsBody.js";
import { FormEditorHeaderText } from "../components/FormEditorHeaderText.js";
import { FormEditorTabStrip } from "../components/FormEditorTabStrip.js";
import { FormEditorMainPanel } from "../components/FormEditorMainPanel.js";
export interface FormEditorProps {
  formId: string;
  /** Which tab is active, derived from the route by `panels.tsx` (`/forms/:formId` -> `"fields"`,
   *  `/forms/:formId/submissions` -> `"submissions"`) — ADR-063. Ignored while `isNew`/tabs aren't
   *  shown. */
  tab: "fields" | "submissions";
  /** Dependency injection seam for tests — see `PostsProps.usePostsHook` for the convention. */
  useFormEditorHook?: typeof useWiredFormEditor;
}

/** The name/slug fields, the field-definition table, and the status-toggle/save action row —
 * shared verbatim between the "new form" view (no tabs) and the
 * "existing form, Fields tab" view (see `FormEditor`'s own `fieldsBody` comment for why it's one
 * JSX value rather than two copies). Split into its own top-level component, not just a local
 * `const`, because a `const` assigned inside `FormEditor` still executes in that function's own
 * scope — every branch inside it would still count toward `FormEditor`'s own complexity score. */
export function FormEditor({ formId, tab, useFormEditorHook = useWiredFormEditor }: FormEditorProps, _optional: Record<string, never> = {}) {
  const {
    answerColumns,
    mode, onModeChange, html, setHtml, copyEmbed, copyFeedback,
    isNew,
    form,
    name,
    setName,
    slug,
    setSlug,
    fields,
    setFields,
    tab: activeTab,
    onTabChange,
    error,
    saving,
    existingFieldIds,
    showTabs,
    tabRefs,
    onTabsKeyDown,
    handleSave,
    handleStatusToggle,
    t,
  } = useFormEditorHook({ formId, tab });

  if (!isNew && !form && !error) return <div className="notice">{t("Loading form…")}</div>;
  // Previously this was the ONLY guard, and it only covers the pre-error case — once the load
  // failed and set `error`, `!error` here goes false and rendering fell through to the full,
  // empty, live-saveable editor below (audit blocker, exec summary #3: a bogus form id showed
  // "form definition 'X' was not found" AND a working Save button underneath it). This guard is
  // safe to add as a second, separate check rather than merging into the one above: it only fires
  // while `form` is still null, so a load failure has to happen before the form ever loaded —
  // once `form` is set, it stays set, so a LATER failure (e.g. a failed Save) never re-enters
  // this branch and never blanks a screen the operator is already editing (same "a later failure
  // must not erase what already rendered" principle as `Pages.tsx`/`Posts.tsx`'s `error && !data`
  // guard — see `CollectionEntryEditor.tsx`'s sequential loading → not-found guards for the
  // reference shape this now matches).
  if (!isNew && !form && error) return <div className="notice error">{error}</div>;

  // Shared between the "new form" (no tabs, always visible) and "existing form, Fields tab"
  // views — kept as one JSX value instead of two copies so the two paths can't drift.
  const fieldsBody = (
    <FormEditorFieldsBody
      mode={mode} onModeChange={onModeChange} html={html} onHtmlChange={setHtml} onCopyEmbed={copyEmbed} copyFeedback={copyFeedback}
      name={name}
      onNameChange={setName}
      slug={slug}
      onSlugChange={setSlug}
      isNew={isNew}
      fields={fields}
      existingFieldIds={existingFieldIds}
      onFieldsChange={setFields}
      form={form}
      saving={saving}
      onStatusToggle={handleStatusToggle}
      onSave={handleSave}
      t={t}
    />
  );

  return (
    <div className="page">
      {/* `page-header-split` (the same modifier `PageEditorHeader`/`PostEditor` use on the shared
          `.page-header`, `styles.css`) — back link alone at the far left, title block centred.
          Forms has no Save/Delete group living in this header (that's inside the fields panel
          below), so the header's third rail just stays empty, same as the editors' post-move
          state. */}
      <div
        className="page-header page-header-split"
        {...agentHandle({ handle: "form-editor-header" }, {
          role: "region",
          label: "Form editor header — title and the Back to forms link",
        })}
      >
        <div className="page-header-lead">
          {/* Plain `<a className="btn-secondary">`, not a `<button>` nested inside an `<a>`
              (invalid HTML, undefined activation behaviour) — same `a.btn-*` mechanism
              `Dashboard.tsx`'s "View site ↗" already uses. Arrow sits outside `t()`, matching
              `FormSubmissionDetail`'s own `&larr; {t("Back")}` below — the glyph is not part of
              the translated string, so no locale block needs to change.

              Visible label shortened to a plain "← Back" (owner, 2026-09-22 — every editor's back
              button reads the same short way now). The destination stays legible: `aria-label`
              carries the full "Back to forms" phrase for screen readers, and `agentHandle`'s own
              `label` (a stable, untranslated identifier — never live text, see `handle.ts`) already
              said "Back to the list of all forms" for agents, unchanged by this. */}
          <a
            className="btn-secondary"
            href="/admin/forms"
            aria-label={t("Back to forms")}
            {...agentHandle({ handle: "form-editor-back" }, { role: "link", label: "Back to the list of all forms" })}
          >
            &larr; {t("Back")}
          </a>
        </div>
        <FormEditorHeaderText isNew={isNew} name={name} t={t} />
      </div>
      {error ? <div className="notice error">{error}</div> : null}

      <FormEditorTabStrip showTabs={showTabs} tab={activeTab} onTabChange={onTabChange} tabRefs={tabRefs} onTabsKeyDown={onTabsKeyDown} t={t} />

      <FormEditorMainPanel isNew={isNew} tab={activeTab} formId={formId} fieldsBody={fieldsBody} t={t} answerColumns={answerColumns} />
    </div>
  );
}

export default FormEditor;
