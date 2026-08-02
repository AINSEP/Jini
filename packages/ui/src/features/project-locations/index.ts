export { createFakeProjectLocationsPort, type FakeProjectLocationsPortOptions } from './dependencies.js';
export type { ProjectLocationsPort } from './ports.js';
export {
  DEFAULT_LOCATION_ID,
  externalLocations,
  isDuplicatePath,
  locationLabel,
  resolveDefaultLocationId,
  saveableDrafts,
  toStoredLocations,
} from './rules.js';
export type {
  ProjectLocation,
  ProjectLocationDraft,
  ProjectLocationsActionResult,
  StoredProjectLocation,
} from './types.js';

export { useProjectLocationsTab } from './react/hooks/useProjectLocationsTab.js';
export type { UseProjectLocationsTabOptions, UseProjectLocationsTabResult } from './react/hooks/useProjectLocationsTab.js';
export { ProjectLocationsTab } from './react/components/ProjectLocationsTab.js';
export type { ProjectLocationsTabLabels, ProjectLocationsTabProps } from './react/components/ProjectLocationsTab.js';
