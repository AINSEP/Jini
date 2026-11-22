import type { useWiredFormEditor } from "../hooks/use-form-editor.hooks.js";
import { FormEditorFieldsBody } from "./FormEditorFieldsBody.js";

/** The name/slug fields, the field table and the action row, wired from the editor state. */
export function FormEditorFieldsSlot({ editor }: { editor: ReturnType<typeof useWiredFormEditor> }) {
  const { provider, setProvider, providers, providersError, mode, onModeChange, html, setHtml, copyEmbed, copyFeedback, isNew, form, name, setName, slug, setSlug,
    fields, setFields, saving, existingFieldIds, handleSave, handleStatusToggle, t } = editor;
  // Shared between the "new form" (no tabs, always visible) and "existing form, Fields tab"
  // views — kept as one JSX value instead of two copies so the two paths can't drift.
  return (
    <FormEditorFieldsBody
      mode={mode} onModeChange={onModeChange} html={html} onHtmlChange={setHtml} onCopyEmbed={copyEmbed} copyFeedback={copyFeedback}
      provider={provider} onProviderChange={setProvider} providers={providers} providersError={providersError}
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
}
