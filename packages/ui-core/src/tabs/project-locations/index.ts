export type { ProjectLocation, ProjectLocationDraft, ProjectLocationsActionResult, StoredProjectLocation } from './types.js';

export {
  DEFAULT_LOCATION_ID,
  externalLocations,
  isDuplicatePath,
  locationLabel,
  resolveDefaultLocationId,
  saveableDrafts,
  toStoredLocations,
} from './rules.js';

export type { ProjectLocationsPort } from './ports.js';
export { createFakeProjectLocationsPort } from './dependencies.js';
export type { FakeProjectLocationsPortOptions } from './dependencies.js';
