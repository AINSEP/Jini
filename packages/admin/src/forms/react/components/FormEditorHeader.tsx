import { agentHandle } from '@jini-ai/core/agent-handles';
import type { MouseEventHandler } from 'react';
import { FormEditorHeaderText } from './FormEditorHeaderText.js';

/** Back link and title block above the form editor. */
export function FormEditorHeader({ isNew, name, onBack, t }: {
  isNew: boolean; name: string; onBack: MouseEventHandler<HTMLAnchorElement>; t: (key: string) => string;
}, _optional: Record<string, never> = {}) {

  // `page-header-split` (the same modifier `PageEditorHeader`/`PostEditor` use on the shared
  // `.page-header`, `styles.css`) — back link alone at the far left, title block centred.
  // Forms has no Save/Delete group living in this header (that's inside the fields panel
  // below), so the header's third rail just stays empty, same as the editors' post-move
  // state.
  return (
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
          onClick={onBack}
          {...agentHandle({ handle: "form-editor-back" }, { role: "link", label: "Back to the list of all forms" })}
        >
          &larr; {t("Back")}
        </a>
      </div>
      <FormEditorHeaderText isNew={isNew} name={name} t={t} />
    </div>
  );
}
