import type { PresentationSettingsRecord } from "../../presentation/presentation.js";
import type { AdminPresentation, HeadlessThemeSummary } from "@jini-ai/core/contracts/headless/contracts";

export function toAdminPresentationResponse(required: {
  settings: Pick<PresentationSettingsRecord, "workspaceId" | "activeThemeId" | "updatedAt">;
  availableThemeIds: string[];
  availableThemes: HeadlessThemeSummary[];
  activeThemeTemplates: string[];
  activeThemeStaticPageIds: string[];
}, _optional = {}): AdminPresentation {
  const { settings, availableThemeIds, availableThemes, activeThemeTemplates, activeThemeStaticPageIds } = required;
  return {
    settings: {
      workspaceId: settings.workspaceId,
      activeThemeId: settings.activeThemeId,
      updatedAt: settings.updatedAt,
    },
    availableThemeIds,
    availableThemes,
    activeThemeTemplates,
    activeThemeStaticPageIds,
  };
}
