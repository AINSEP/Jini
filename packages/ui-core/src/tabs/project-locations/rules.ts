import type { ProjectLocation, ProjectLocationDraft, StoredProjectLocation } from './types.js';

/**
 * The id meaning "the host's own default root".
 *
 * Always valid, never in the editable list, and the fallback whenever a
 * configured default no longer resolves — see `resolveDefaultLocationId`.
 */
export const DEFAULT_LOCATION_ID = 'default';

/**
 * The display label for a path: its last segment.
 *
 * Splits on BOTH separators, so a Windows path renders correctly on a host
 * that never sees backslashes natively and vice versa. Empty segments are
 * dropped first, which is what makes a trailing separator harmless
 * (`/a/b/` still labels as `b`). Falls back to the whole path when there is
 * no segment to take — a bare `/` has no basename, and showing an empty
 * label would render an unclickable blank row.
 */
export function locationLabel(locationPath: string): string {
  return locationPath.split(/[\\/]/).filter(Boolean).pop() || locationPath;
}

/** The operator-managed locations — built-ins are the host's, not theirs. */
export function externalLocations(locations: readonly ProjectLocation[]): ProjectLocationDraft[] {
  return locations
    .filter((location) => !location.builtIn)
    .map((location) => ({ id: location.id, path: location.path }));
}

/** The same filter, projected to the shape a host persists. */
export function toStoredLocations(locations: readonly ProjectLocation[]): StoredProjectLocation[] {
  return locations
    .filter((location) => !location.builtIn)
    .map((location) => ({ id: location.id, name: location.name, path: location.path }));
}

/**
 * The drafts worth sending: those with a real path.
 *
 * A blank row is the editor's own "add" affordance, not a location. Sending it
 * would ask the host to create a root at the empty string.
 */
export function saveableDrafts(drafts: readonly ProjectLocationDraft[]): ProjectLocationDraft[] {
  return drafts.filter((draft) => draft.path.trim().length > 0);
}

/**
 * Resolves which location the default should point at after a save.
 *
 * The configured default can go stale — the operator can remove the very
 * location it names. Keeping a dangling id would leave new projects pointing
 * at nothing, so anything that no longer resolves falls back to
 * `DEFAULT_LOCATION_ID`, which always exists.
 *
 * `DEFAULT_LOCATION_ID` itself is accepted without being in the list, since it
 * names the host's built-in root rather than a row.
 */
export function resolveDefaultLocationId(
  configuredId: string | null | undefined,
  locations: readonly ProjectLocation[],
): string {
  const configured = configuredId ?? DEFAULT_LOCATION_ID;
  if (configured === DEFAULT_LOCATION_ID) return DEFAULT_LOCATION_ID;
  return locations.some((location) => location.id === configured) ? configured : DEFAULT_LOCATION_ID;
}

/**
 * Whether a path is already claimed by another location.
 *
 * Compared on the trimmed path, ignoring any trailing separator, so `/a/b` and
 * `/a/b/` are recognised as the same root — a folder picker and a typed path
 * routinely disagree on that trailing slash. `exceptId` lets a row exclude
 * itself, so re-saving an unchanged location is not reported as a duplicate of
 * itself.
 */
export function isDuplicatePath(
  candidatePath: string,
  locations: readonly ProjectLocation[],
  exceptId?: string,
): boolean {
  const needle = normalizePathForCompare(candidatePath);
  if (!needle) return false;
  return locations.some(
    (location) => location.id !== exceptId && normalizePathForCompare(location.path) === needle,
  );
}

/** Trimmed, with any trailing separator removed — but never reduced to empty
 *  for a root path, which legitimately IS its separator. */
function normalizePathForCompare(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 1) return trimmed;
  return trimmed.replace(/[\\/]+$/, '') || trimmed;
}
