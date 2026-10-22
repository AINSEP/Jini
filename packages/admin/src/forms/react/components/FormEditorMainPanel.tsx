import type * as React from 'react';
import type { FormAnswerColumn } from '../../html-rules.js';
import { FormSubmissions } from "./FormSubmissions.js";
export function FormEditorMainPanel(props: {
  isNew: boolean;
  tab: "fields" | "submissions";
  formId: string;
  fieldsBody: React.ReactNode;
  /** Translator closure — see `FormEditor()`'s own `t`. */
  t: (key: string) => string;
  answerColumns: FormAnswerColumn[];
}, _optional: Record<string, never> = {}) {
  const { isNew, tab, formId, fieldsBody, t, answerColumns } = props;

  if (isNew) {
    return <div className="form-editor-panel">{fieldsBody}</div>;
  }
  if (tab === "fields") {
    return (
      <div className="form-editor-panel" role="tabpanel" id="form-panel-fields" aria-labelledby="form-tab-fields">
        {fieldsBody}
      </div>
    );
  }
  return (
    <div className="form-editor-panel" role="tabpanel" id="form-panel-submissions" aria-labelledby="form-tab-submissions">
      <FormSubmissions formId={formId} t={t} answerColumns={answerColumns} />
    </div>
  );
}

