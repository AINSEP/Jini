import { ConfirmDialog } from '../../../react/components/ConfirmDialog/ConfirmDialog.js';
import { useWiredFormEditor } from "../hooks/use-form-editor.hooks.js";
import { FormEditorFieldsSlot } from "../components/FormEditorFieldsSlot.js";
import { FormEditorHeader } from "../components/FormEditorHeader.js";
import { FormEditorTabStrip } from "../components/FormEditorTabStrip.js";
import { FormEditorMainPanel } from "../components/FormEditorMainPanel.js";
export interface FormEditorProps {
  formId: string;
  /** Which tab is active, derived from the route by `panels.tsx` (`/forms/:formId` -> `"fields"`,
   *  `/forms/:formId/submissions` -> `"submissions"`). Ignored while `isNew`/tabs aren't
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
export function FormEditor({ formId, tab, useFormEditorHook = useWiredFormEditor }: FormEditorProps) {
  const editor = useFormEditorHook({ formId, tab });
  const { answerColumns, isNew, form, name, tab: activeTab, onTabChange, error, showTabs, tabRefs, onTabsKeyDown, leave, t } = editor;

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

  const fieldsBody = <FormEditorFieldsSlot editor={editor} />;

  return (
    <div className="page">
      <FormEditorHeader isNew={isNew} name={name} onBack={leave.onBack} t={t} />
      {error ? <div className="notice error">{error}</div> : null}

      <FormEditorTabStrip showTabs={showTabs} tab={activeTab} onTabChange={onTabChange} tabRefs={tabRefs} onTabsKeyDown={onTabsKeyDown} t={t} />

      <FormEditorMainPanel isNew={isNew} tab={activeTab} formId={formId} fieldsBody={fieldsBody} t={t} answerColumns={answerColumns} />
      {/* Back with unsaved edits asks first (Chrome check, 2026-10-11) — the admin's confirm modal. */}
      <ConfirmDialog
        open={leave.confirmOpen}
        agentHandle="form-editor-leave-confirm"
        title={t("Discard unsaved changes?")}
        body={<p>{t("Your changes to this form have not been saved.")}</p>}
        confirmLabel={t("Discard changes")}
        cancelLabel={t("Keep editing")}
        tone="danger"
        onConfirm={leave.confirm}
        onCancel={leave.cancel}
      />
    </div>
  );
}

export default FormEditor;
