/** The host's page-editor dictionary lookup; the email editor toolbar reuses its copy. */
export type EmailPageEditorTranslate = (required: { locale: string; key: string }) => string;

/** Bind shared page-editor copy for the email editor toolbar. */
export function createEmailPageTranslator({ locale, pageEditorT }: { locale: string; pageEditorT: EmailPageEditorTranslate }, _options = {}) {
  return (key: string) => pageEditorT({ locale, key });
}
