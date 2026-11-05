import type { AdminFormProviderSelection } from "../../../core/ports/forms.js";
import { useFormFieldsBodyView } from "../hooks/forms-view.hooks.js";
import type { AdminFormDefinition, AdminFormField } from '../../models.js';
import { agentHandle } from '@jini-ai/agentic';
import { FormEditorActions, FormEditorModeSwitch } from "./FormEditorFieldsBodyParts.js";
export interface FormEditorFieldsBodyProps {
  provider?: AdminFormProviderSelection;
  onProviderChange?: (value: AdminFormProviderSelection) => void;
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

/** Edit the existing form body and explicit collection destination without crossing their state boundaries.
 * @complexity O(f) render time/space for fields; event callbacks perform no direct I/O.
 * @overallScore 94 — Low: the approved two-provider selector needs another option for future providers. */
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
        <label htmlFor="form-provider">{t("Where answers go")}</label>
        <select id="form-provider" value={props.provider?.id ?? "builtin"} onChange={event => props.onProviderChange?.({ id: event.target.value, config: {} })}>
          <option value="builtin">{t("Built-in inbox")}</option>
          <option value="formspree">Formspree</option>
          {props.provider && !["builtin", "formspree"].includes(props.provider.id) ? <option value={props.provider.id}>{props.provider.id}</option> : null}
        </select>
        {props.provider?.id === "formspree" ? <>
          <label htmlFor="form-provider-endpoint">{t("Public form endpoint")}</label>
          <input id="form-provider-endpoint" type="url" value={props.provider.config.endpoint ?? ""} placeholder="https://formspree.io/f/form-id" onChange={event => props.onProviderChange?.({ id: "formspree", config: { endpoint: event.target.value } })} />
          <p>{t("Answers go directly to your Formspree account. Browser and Formspree validation apply. Formspree supplies spam protection according to your account settings.")}</p>
          <p>{t("Enable the Formspree plugin before using this form. Republish every static page containing this form after switching providers.")}</p>
        </> : <p>{t("Answers stay in the built-in inbox. Switching providers preserves your existing definitions and submission history.")}</p>}
      </div>

      <div className="field-group">
        <FormEditorModeSwitch props={props} handlers={handlers} />
      </div>

      {(!props.provider || props.provider.id === "builtin") ? <div className="field-group">
        <p><strong>{t("Basic spam protection is on.")}</strong></p>
        <p className="muted">{t("Hidden-field checks, submission timing when available, duplicate suppression, and rate limits.")}</p>
        <p className="muted">{t("Live server defaults: wait 1 second; up to 5 submissions per minute per IP address and form.")}</p>
        <p className="muted">{t("Exported forms use their destination's protection; timing and duplicate suppression may be unavailable. Custom embeds need the generated hidden controls for hidden-field checks.")}</p>
      </div> : null}

      <FormEditorActions props={props} />
    </>
  );
}

/** The page-header title/description text — split out because `FormEditor`'s isNew-dependent copy
 * (two ternaries, one with a `||` fallback) is otherwise indistinguishable, in the complexity
 * count, from the branches that actually decide what's on screen. */
