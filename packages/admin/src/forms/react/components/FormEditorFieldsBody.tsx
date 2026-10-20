import { useFormFieldsBodyView } from "../hooks/forms-view.hooks.js";
import type { AdminFormDefinition, AdminFormField } from '../../models.js';
import { agentHandle } from '@jini-ai/agentic';
import { FormEditorActions, FormEditorModeSwitch } from "./FormEditorFieldsBodyParts.js";
export interface FormEditorFieldsBodyProps {
  name: string;
  onNameChange: (value: string) => void;
  slug: string;
  onSlugChange: (value: string) => void;
  isNew: boolean;
  fields: AdminFormField[];
  existingFieldIds: string[];
  onFieldsChange: (fields: AdminFormField[]) => void;
  form: AdminFormDefinition | null;
  saving: boolean;
  onStatusToggle: () => void;
  onSave: () => void;
  /** Translator closure — see `FormEditor()`'s own `t`. */
  t: (key: string) => string;
  mode: "builder" | "html";
  onModeChange: (mode: "builder" | "html") => void;
  html: string;
  onHtmlChange: (html: string) => void;
  onCopyEmbed: () => void;
  copyFeedback: string | null;
}

export function FormEditorFieldsBody(props: FormEditorFieldsBodyProps) {
  const handlers = useFormFieldsBodyView(props);
  const { name, slug, isNew, t } = props;

  return (
    <>
      <div className="field-group">
        <div className="field-row">
          <div className="field">
            <label className="field-label" htmlFor="form-name">
              {t("Name")}
            </label>
            <input
              id="form-name"
              value={name}
              onChange={handlers.onName}
              {...agentHandle({ handle: "form-editor-name" }, { role: "field", label: "This form's display name" })}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="form-slug">
              {t("Slug")}
            </label>
            <input
              id="form-slug"
              value={slug}
              disabled={!isNew}
              onChange={handlers.onSlug}
              {...agentHandle({ handle: "form-editor-slug" }, {
                role: "field",
                label: "This form's URL slug — only editable while creating a new form",
              })}
            />
          </div>
        </div>
      </div>

      <div className="field-group">
        <FormEditorModeSwitch props={props} handlers={handlers} />
      </div>

      <FormEditorActions props={props} />
    </>
  );
}

/** The page-header title/description text — split out because `FormEditor`'s isNew-dependent copy
 * (two ternaries, one with a `||` fallback) is otherwise indistinguishable, in the complexity
 * count, from the branches that actually decide what's on screen. */
