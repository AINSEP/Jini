/**
 * @file Rules for a `widgetEmbed` node's per-placement `content` override (mediawidget contract,
 * "Per-placement content"): `attrs.content` shallow-merges over the saved widget's config at render
 * time, for this one spot only; `null` means "use the widget's content". Pure — the Style dialog's
 * state lives in `widget-embed-extension.hooks.ts`.
 */

/** Widget types whose config is media content and so can be overridden per placement. */
const PLACEMENT_CONTENT_TYPES: readonly string[] = ["media", "gallery"];

export function supportsPlacementContent({ widgetType }: { widgetType: string | null | undefined }, _options = {}): boolean {
  return typeof widgetType === "string" && PLACEMENT_CONTENT_TYPES.includes(widgetType);
}

/** The Style dialog's override draft: whether this spot has its own content, and that content. */
export interface PlacementContentDraft {
  custom: boolean;
  content: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Seeds the draft when the dialog opens: an existing override is edited as-is; otherwise the
 * widget's saved config is the starting point, so choosing "Custom for this post" begins from what
 * the spot shows today instead of an empty list.
 */
export function initialPlacementDraft(required: { attrsContent: unknown; widgetConfig: unknown }): PlacementContentDraft {
  if (isRecord(required.attrsContent)) return { custom: true, content: required.attrsContent };
  return { custom: false, content: isRecord(required.widgetConfig) ? { ...required.widgetConfig } : {} };
}

/** The value written to `attrs.content` on Save: the override, or `null` to use the widget's. */
export function placementContentAttr(required: { draft: PlacementContentDraft }): Record<string, unknown> | null {
  return required.draft.custom ? required.draft.content : null;
}
