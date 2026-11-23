/**
 * Keep a content row's saved choice visible even when the active theme no longer offers it.
 * Append it after applicable options so the theme's first-listed default stays first.
 */
export function editorTemplateOptions(
  required: { templates: string[]; savedTemplate: string | null | undefined },
  _optional: Record<string, never> = {}
): string[] {
  const { templates, savedTemplate } = required;
  return savedTemplate && !templates.includes(savedTemplate) ? [...templates, savedTemplate] : templates;
}
