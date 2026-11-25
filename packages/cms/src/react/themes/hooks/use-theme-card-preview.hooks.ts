import { useState } from "react";

/** D-22: new servers name the actual image (or no image). Older servers retain the fallback.
 * A later rescan can replace the URL, so failure state is scoped to the advertised source.
 */
export function useThemeCardPreview(
  { themeId, previewImageUrl }: { themeId: string; previewImageUrl?: string | null },
  _optional: Record<string, never> = {},
) {
  const [failure, setFailure] = useState<{ source: string | null | undefined; stage: "png" | "failed" } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const stage = failure && failure.source === previewImageUrl ? failure.stage : "jpg";
  const failed = previewImageUrl === null || stage === "failed";
  const src = previewImageUrl ?? `/theme-assets/${themeId}/screenshots/index.${stage === "png" ? "png" : "jpg"}`;
  const handleError = () => {
    // Advertised assets must not cause a second speculative request if removed after discovery.
    setFailure({ source: previewImageUrl, stage: previewImageUrl === undefined && stage === "jpg" ? "png" : "failed" });
    setExpanded(false);
  };
  return { failed, src, expanded, setExpanded, handleError };
}
