import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { PresentationSettingsNotFoundError, PresentationSettingsValidationError } from "../../../presentation/presentation.js";
import type { PresentationSettingsRecord } from "../../../presentation/presentation.js";
import { authorizeThemeSet, type PresentationRoutePrincipal, type PresentationThemeView } from "./shared.js";

/**
 * @file `PATCH /api/admin/v1/workspaces/:workspaceId/presentation` — switch the active theme.
 *
 * Gated by `theme.set`. The write itself is the host's (`setActiveTheme`, bound to its presentation
 * repo, tracker, clock and the write allowlist for the requested id), as are theme discovery, the
 * preview-refresh signal and the response DTO. An unexpected failure is rethrown: the host answers
 * it with its operation-only failure copy.
 */

/** One card of the PATCH response's theme list (the GET adds preview fields; this route never did). */
export interface PresentationPatchThemeCard { id: string; name: string; tier: string; apiVersion: number | undefined }

/** The fields the host's response DTO is built from. */
export interface PresentationPatchResponseFields {
  settings: PresentationSettingsRecord;
  availableThemeIds: string[];
  availableThemes: PresentationPatchThemeCard[];
  activeThemeTemplates: string[];
  activeThemeStaticPageIds: string[];
}

/** The deps this route reads. */
export interface PresentationPatchRouteDeps {
  workspaceId: string;
  /** The host's active-theme write for this workspace, as `actorId` (source "admin"). */
  setActiveTheme: (required: { activeThemeId: string; actorId: string }) => Promise<{ settings: PresentationSettingsRecord }>;
  /** Whether a write failure is the host's "this theme needs styling first" refusal (a 400). */
  isThemeStylingRequired: (required: { err: unknown }) => boolean;
  themes: () => readonly PresentationThemeView[];
  /** The READ catalogue of pickable theme ids (valid themes only — never the write allowlist). */
  catalogThemeIds: () => string[];
  findStoredTheme: (required: { id: string }) => PresentationThemeView | undefined;
  /** Signals open theme previews that the active theme changed. */
  requestThemePreviewRefresh: () => void;
  toPresentationResponse: (required: PresentationPatchResponseFields) => object;
}

/**
 * The PATCH body's `activeThemeId`, defaulting to `""` for a missing/non-object body or a missing
 * field. The write's own allowlist check then turns that into a validation error naming the empty
 * string, so a malformed body reads as "no theme id" rather than a raw parse failure.
 */
function readActiveThemeId({ body }: { body: unknown }, _optional: Record<string, never> = {}): string {
  return String((body as { activeThemeId?: unknown } | null)?.activeThemeId ?? "");
}

/** The write's failure ladder: validation/styling → flat 400, a missing row → flat 404, else rethrow. */
function rejectPatchError({ err, deps }: { err: unknown; deps: PresentationPatchRouteDeps }, _optional: Record<string, never> = {}): never {
  if (err instanceof PresentationSettingsValidationError || deps.isThemeStylingRequired({ err })) rejectRoute({ status: 400, error: (err as Error).message });
  if (err instanceof PresentationSettingsNotFoundError) rejectRoute({ status: 404, error: err.message });
  throw err;
}

/** The response, recomputed from the NEWLY active theme so both template pickers follow the switch.
 * @complexity O(t) in the discovered theme count. */
function patchResponse({ settings, deps }: { settings: PresentationSettingsRecord; deps: PresentationPatchRouteDeps }, _optional: Record<string, never> = {}): object {
  const activeTheme = deps.findStoredTheme({ id: settings.activeThemeId });
  deps.requestThemePreviewRefresh();
  const availableThemes = deps.themes()
    .filter((t) => t.status === "valid")
    .map((t) => ({ id: t.manifest.id, name: t.manifest.name, tier: t.manifest.tier, apiVersion: t.manifest.apiVersion }));
  return deps.toPresentationResponse({
    settings,
    // The read catalogue, NOT the write allowlist the write validated against (that one carries the
    // "no theme" id, which would render a blank picker card on the request that turns the theme off).
    availableThemeIds: deps.catalogThemeIds(),
    availableThemes,
    activeThemeTemplates: [...(activeTheme?.manifest.templates ?? [])],
    activeThemeStaticPageIds: activeTheme ? Object.keys(activeTheme.pages) : [],
  });
}

export const presentationPatchRoute = defineJsonRoute<{ activeThemeId: string }, object, PresentationPatchRouteDeps, PresentationRoutePrincipal>({
  method: "patch",
  path: "/api/admin/v1/workspaces/:workspaceId/presentation",
  parse: (raw) => ok({ value: { activeThemeId: readActiveThemeId({ body: raw.body }) } }),
  handle: async ({ input, deps, context, authorize }) => {
    // One ladder over the whole request, as the hand-written route's single `try` covered it.
    try {
      await authorizeThemeSet({ authorize });
      if (!context) throw new Error("presentation admin route has no authenticated principal");
      const { settings } = await deps.setActiveTheme({ activeThemeId: input.activeThemeId, actorId: context.id });
      return ok({ value: patchResponse({ settings, deps }) });
    } catch (err) {
      return rejectPatchError({ err, deps });
    }
  },
});
