/**
 * @file Public surface (barrel) for the `presentation` library.
 *
 * Presentation owns one thing: which theme a workspace is currently presenting under. It is a
 * distinct domain from `settings` (the generic definitions/values/revision-ledger model) even
 * though a host's settings migration reads from it — the dependency runs settings -> presentation
 * and never the other way, which is what lets the two ship as separate subpaths.
 */
export {
  ALLOWED_THEME_IDS,
  getPresentationSettings,
  setActiveTheme,
  PresentationSettingsNotFoundError,
  PresentationSettingsValidationError,
  type GetPresentationSettingsRequired,
  type PresentationOptional,
  type PresentationSettingsRecord,
  type PresentationSettingsRepoPort,
  type SetActiveThemeDeps,
  type SetActiveThemeRequired,
  type ThemeId,
} from "./presentation.js";

export { InMemoryPresentationSettingsRepo } from "./repo.memory.js";

/**
 * There is no SQLite adapter export here, deliberately — same reasoning as `workspace/index.ts`:
 * a concrete adapter names a host's schema, so hosts compose their own against the port above.
 */
