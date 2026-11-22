/** CMS content kinds a theme template may be offered to. */
export type ThemeTemplateKind = "post" | "page";
export type ThemeTemplateFor = Readonly<Record<string, readonly ThemeTemplateKind[]>>;

export type TemplateForIssue =
  | { readonly kind: "invalid-map" }
  | { readonly kind: "undeclared-template"; readonly template: string }
  | { readonly kind: "invalid-kinds"; readonly template: string };

/**
 * Parse optional applicability metadata. Malformed declarations throw so both discovery and
 * package validation reject them rather than silently offering the wrong templates.
 */
export function parseTemplateFor(
  required: { value: unknown; templates?: readonly string[]; onInvalid: (required: { issue: TemplateForIssue }) => never },
  _optional: Record<string, never> = {}
): ThemeTemplateFor | undefined {
  const { value, templates, onInvalid } = required;
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return onInvalid({ issue: { kind: "invalid-map" } });
  }
  const declared = new Set(templates ?? []);
  const entries = Object.entries(value).map(([template, kinds]) => {
    if (!declared.has(template)) {
      return onInvalid({ issue: { kind: "undeclared-template", template } });
    }
    if (!Array.isArray(kinds) || kinds.length === 0 ||
        !kinds.every((kind) => kind === "post" || kind === "page") ||
        new Set(kinds).size !== kinds.length) {
      return onInvalid({ issue: { kind: "invalid-kinds", template } });
    }
    return [template, kinds as ThemeTemplateKind[]] as const;
  });
  return Object.fromEntries(entries);
}

/**
 * Offer applicable templates in manifest order. Missing metadata applies to both kinds;
 * omitting kind returns the full catalog for callers outside the content editors.
 */
export function applicableThemeTemplates(
  required: { manifest?: { templates?: readonly string[]; templateFor?: ThemeTemplateFor }; kind?: ThemeTemplateKind },
  _optional: Record<string, never> = {}
): string[] {
  const { manifest, kind } = required;
  return (manifest?.templates ?? []).filter((template) => {
    const mapping = manifest?.templateFor;
    const kinds = mapping && Object.hasOwn(mapping, template) ? mapping[template] : undefined;
    return kind === undefined || kinds === undefined || kinds.includes(kind);
  });
}

export function rejectTemplateFor({ issue }: { issue: TemplateForIssue }, _optional = {}): never {
  if (issue.kind === "invalid-map") {
    throw new Error("theme.json templateFor must be an object mapping template names to content kinds");
  }
  if (issue.kind === "undeclared-template") {
    throw new Error(`theme.json templateFor '${issue.template}' is not listed in templates`);
  }
  throw new Error(`theme.json templateFor '${issue.template}' must be a non-empty array of unique 'post'/'page' kinds`);
}
