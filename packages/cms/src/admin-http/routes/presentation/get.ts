import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { getPresentationSettings, PresentationSettingsNotFoundError } from "../../../presentation/presentation.js";
import type { PresentationSettingsRecord, PresentationSettingsRepoPort } from "../../../presentation/presentation.js";
import { authorizeThemeSet, type PresentationRoutePrincipal, type PresentationTemplateKind, type PresentationThemeView } from "./shared.js";

/** One card of the Themes screen's catalogue, as this route builds it. */
export interface PresentationThemeCard {
  id: string;
  name: string;
  tier: string;
  apiVersion: number | undefined;
  builtIn: boolean;
  previewImageUrl: string | null;
}

/** The fields the host's presentation DTO is shaped from. */
export interface PresentationResponseFields {
  settings: PresentationSettingsRecord;
  availableThemeIds: string[];
  availableThemes: PresentationThemeCard[];
  activeThemeTemplates: string[];
  activeThemeStaticPageIds: string[];
}

/**
 * The deps this route reads. The theme list, its stored-id lookup (retired ids included), the
 * package-shipped check, the card preview URL and whether this site can capture previews are the
 * host's theme discovery and preview host; the response DTO is the host's wire contract.
 * `presentationRepo` is the whole port because `getPresentationSettings` takes the whole port.
 */
export interface PresentationGetRouteDeps {
  workspaceId: string;
  presentationRepo: PresentationSettingsRepoPort;
  themes: () => readonly PresentationThemeView[];
  /** The READ catalogue of pickable theme ids (valid themes only — never the write allowlist). */
  catalogThemeIds: () => string[];
  findStoredTheme: (required: { id: string }) => PresentationThemeView | undefined;
  isPackageShippedTheme: (required: { manifest: { id: string; tier: string } }) => boolean;
  previewCapturesEnabled: () => boolean;
  themeCardPreviewUrl: (required: { theme: { dir: string; id: string; tier: string }; capturesEnabled: boolean }) => string | null;
  toPresentationResponse: (required: PresentationResponseFields) => object;
  /** The themes domain's template filter (`applicableThemeTemplates`), injected so this presentation
   *  entry does not reach into the themes domain; the host binds the engine's own function. */
  applicableThemeTemplates: (required: { manifest?: PresentationThemeView["manifest"]; kind?: PresentationTemplateKind }) => string[];
}

/**
 * The active-theme half of the response.
 * Template-picker feature (2026-08-10, unified 2026-08-11) — the active theme's own declared
 * template list, so BOTH the Post editor's and the Pages editor's pickers always reflect whichever
 * theme is actually live right now (one shared field since the unified `content` marker).
 * `findStoredTheme`, not an exact match: a stored retired id (one a theme was renamed from) still
 * names the active theme, and the response reports the id the theme list shows.
 * @complexity O(templates + pages) of the active theme.
 */
function activeThemeResponseFields(
  { deps, settings }: { deps: Pick<PresentationGetRouteDeps, "findStoredTheme" | "applicableThemeTemplates">; settings: PresentationSettingsRecord },
  { kind }: { kind?: PresentationTemplateKind | undefined } = {},
) {
  const activeTheme = deps.findStoredTheme({ id: settings.activeThemeId });
  // Editors request their kind; catalog callers omit it and retain the full list.
  const activeThemeTemplates = deps.applicableThemeTemplates({ ...(activeTheme ? { manifest: activeTheme.manifest } : {}), ...(kind === undefined ? {} : { kind }) });
  // Slug-collision override (2026-08-10) — every page id the active theme ships, so the editor
  // can warn when a post's own slug is currently claimed by one of the theme's own pages.
  const activeThemeStaticPageIds = activeTheme ? Object.keys(activeTheme.pages) : [];
  return {
    settings: activeTheme ? { ...settings, activeThemeId: activeTheme.manifest.id } : settings,
    activeThemeTemplates,
    activeThemeStaticPageIds,
  };
}

/**
 * Themes admin screen (2026-08-10) — tier alongside id for every valid theme, so the Themes screen
 * can group cards by tier without a second round trip. Filtered to `status === "valid"` to match the
 * catalogue's own filter (an invalid theme is not one an operator can pick). `builtIn` (2026-10-10):
 * a theme the package ships, which the card menu won't offer to delete. Card previews are captures
 * of each theme's own render where this site can take them; elsewhere the shipped `screenshots/` file.
 * @complexity O(themes).
 */
function availableThemeCards({ deps }: { deps: PresentationGetRouteDeps }, _optional: Record<string, never> = {}): PresentationThemeCard[] {
  const capturesEnabled = deps.previewCapturesEnabled();
  return deps.themes()
    .filter((t) => t.status === "valid")
    .map((t) => ({ id: t.manifest.id, name: t.manifest.name, tier: t.manifest.tier, apiVersion: t.manifest.apiVersion,
      builtIn: deps.isPackageShippedTheme({ manifest: t.manifest }),
      previewImageUrl: deps.themeCardPreviewUrl({ theme: { dir: t.dir, id: t.manifest.id, tier: t.manifest.tier }, capturesEnabled }) }));
}

/**
 * GET presentation settings (active theme + available themes).
 *
 * Gated by the existing `theme.set` permission — there is no dedicated read permission for
 * presentation settings in the catalog, and `activeThemeId` is currently the only field this
 * resource has, so the same permission that gates changing it also gates reading it (same
 * single-permission-per-domain reasoning as `member.manage`). This reuses a write-shaped permission
 * name for a read route, deliberately.
 */
export const presentationGetRoute = defineJsonRoute<{ kind?: PresentationTemplateKind }, object, PresentationGetRouteDeps, PresentationRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/presentation",
  // Refused in `parse`, before the session is read: the hand-written route checked `kind` first.
  parse: (raw) => {
    const kind = raw.query.kind;
    if (kind === undefined) return ok({ value: {} });
    if (kind === "post" || kind === "page") return ok({ value: { kind } });
    return rejectRoute({ status: 400, error: "kind must be 'post' or 'page'" });
  },
  handle: async ({ input, deps, authorize }) => {
    await authorizeThemeSet({ authorize });
    try {
      // **Deliberately NOT the write allowlist.** This list is echoed straight back to the client as
      // `availableThemeIds` and is what the admin's theme picker renders one card per entry from — it
      // is a READ CATALOGUE of themes an operator can pick, not a set of values the API will accept.
      // The PATCH route passes a DIFFERENT list through an identically-named field: its writable ids
      // append the "no theme" sentinel so "turn the theme off" is a storable value. That sentinel must
      // never appear HERE — it would render as a blank card in the picker, with no type error, no
      // failing test and no gate to catch it.
      const result = await getPresentationSettings({
        deps: { repo: deps.presentationRepo, availableThemeIds: deps.catalogThemeIds() },
        input: { workspaceId: deps.workspaceId },
      });
      const active = activeThemeResponseFields({ deps, settings: result.settings }, { kind: input.kind });
      return ok({ value: deps.toPresentationResponse({ ...active, availableThemeIds: result.availableThemeIds, availableThemes: availableThemeCards({ deps }) }) });
    } catch (err) {
      if (err instanceof PresentationSettingsNotFoundError) rejectRoute({ status: 404, error: err.message });
      throw err;
    }
  },
});
