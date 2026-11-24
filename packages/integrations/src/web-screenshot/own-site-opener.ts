import { ToolInputError } from "@jini-ai/core";

import { WEB_SCREENSHOT_TOOL_ID, type OpenOwnSite, type OwnSiteServer } from "./web-screenshot.js";

/**
 * @file The own-site opener behind `web_screenshot_page`'s `sitePath` + `themeId`: checks the theme
 * against this site's discovered themes, then boots the per-call loopback server with that theme as a
 * render override (`openLoopbackSiteServer` -> `RouteDeps.createSiteApp({ themeId })`).
 *
 * Why the check lives here and not in the render: the site render (`resolveActiveTheme`) quietly
 * falls back to the default theme for an unknown or invalid id, which is right for visitors but would
 * hand the agent a picture of the WRONG theme to compare against its reference (2026-10-08, the
 * "match a reference site" loop in the host theme skill, Part C).
 *
 * Every capture's app also leaves out the cookie consent layer (`consentAudit`): with the banner on
 * by default, each picture showed it over the page and the agent could not judge the layout
 * (2026-10-27). The option belongs to this throwaway app only; visitors still get the banner.
 */

/** The slice of a discovered theme this needs (`DiscoveredTheme` satisfies it structurally). */
export interface RenderableTheme { manifest: { id: string }; status: string }

/** Boots this site's app on a loopback origin; `optional.themeId` is the render override and
 * `optional.consentAudit` leaves out the cookie consent layer. */
export type OpenLoopbackSite = (required: {}, optional: { themeId?: string; consentAudit?: true }) => Promise<OwnSiteServer>;

function refusal({ message }: { message: string }, _optional = {}): ToolInputError {
  return new ToolInputError({ message: `${WEB_SCREENSHOT_TOOL_ID}: ${message}` });
}

/**
 * @param required.themes - The boot-discovered roster. Read per call: discovery and `theme_duplicate`
 *   mutate it in place, so a copy made after boot is visible without a restart.
 * @param required.openLoopback - Boots the server (`openLoopbackSiteServer` over the site's deps).
 * @returns An {@link OpenOwnSite}. It throws ToolInputError for an unknown or invalid `themeId`, before booting anything.
 * @complexity O(themes) per call.
 */
export function createOwnSiteOpener({ themes, openLoopback }: { themes: readonly RenderableTheme[]; openLoopback: OpenLoopbackSite }): OpenOwnSite {
  return async (_required = {}, { themeId } = {}) => {
    if (themeId === undefined) return openLoopback({}, { consentAudit: true });
    const theme = themes.find((candidate) => candidate.manifest.id === themeId);
    if (!theme) {
      const installed = themes.filter((candidate) => candidate.status === "valid").map((candidate) => candidate.manifest.id);
      throw refusal({ message: `themeId '${themeId}' is not an installed theme. Installed themes: ${installed.join(", ") || "none"}.` });
    }
    if (theme.status !== "valid") throw refusal({ message: `themeId '${themeId}' is installed but invalid (it fails theme validation), so the site would render a different theme instead. Fix the theme first.` });
    return openLoopback({}, { themeId, consentAudit: true });
  };
}
