import type { UUID } from "@jini-ai/core/primitives";
import {
  getPresentationSettings,
  PresentationSettingsNotFoundError,
  type PresentationSettingsRepoPort,
} from "../index.js";

/**
 * @file "Which theme id does this workspace have configured" — split out of
 * `features/theme/active-theme.ts` 2026-08-16 (same-day follow-up to that file's own move) once
 * measurement showed this specific function has ZERO dependency on theme data: it only reads
 * `PresentationSettingsRepoPort` and returns a bare string, never touching `DiscoveredTheme` or
 * `findTheme`. Homing it in `features/theme` alongside {@link resolveActiveTheme} (which DOES need
 * theme data) would have created a real `features/theme -> features/presentation` edge for no
 * reason — and `features/presentation` was independently confirmed (via the host's own
 * `check:architecture` dependency-cruiser graph, Tarjan SCC computed before/after) to already be a
 * member of the pre-existing 36-module fused strongly-connected component, while `features/theme`
 * was not. That edge would have pulled `features/theme` into the SCC — a real, measured,
 * AVOIDABLE regression this split exists to prevent. See
 * the host's 2026-08-16 export-edge decoupling report for the full before/after.
 *
 * Imports directly from `@jini-ai/cms/presentation` rather than this module's own
 * host presentation barrel — a sibling file re-importing its own directory's
 * barrel is unnecessary indirection; `index.ts` re-exports the identical external symbols this file
 * needs, so there is no local logic being bypassed.
 */

/** The narrow slice {@link resolveActiveThemeId} needs. */
export interface ActiveThemeIdResolutionDeps {
  presentationRepo: PresentationSettingsRepoPort;
  workspaceId: UUID;
}

/**
 * Resolves the workspace's stored `activeThemeId` preference, degrading to `""` — which
 * `features/theme/active-theme.ts`'s {@link resolveActiveTheme} treats as "missing/invalid, fall
 * back to the first valid theme" — when the workspace has no `presentation_settings` row yet at all
 * (a freshly created workspace, or a `content.db` mid-seed), rather than letting
 * `getPresentationSettings`'s `PresentationSettingsNotFoundError` propagate uncaught. Any OTHER
 * error (a real repo/DB failure) still propagates unchanged — this narrows only the one documented
 * "no row yet" case.
 *
 * Exported so the host's site-export route manifest and its public site pages route resolve the SAME active
 * theme id the real routes render with — one source of truth for "what theme is live" rather than a
 * second copy of this fallback.
 */
export async function resolveActiveThemeId(deps: ActiveThemeIdResolutionDeps): Promise<string> {
  try {
    const { settings } = await getPresentationSettings({
      deps: { repo: deps.presentationRepo },
      input: { workspaceId: deps.workspaceId },
    });
    return settings.activeThemeId;
  } catch (err) {
    if (err instanceof PresentationSettingsNotFoundError) return "";
    throw err;
  }
}
