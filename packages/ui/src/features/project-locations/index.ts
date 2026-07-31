export type { ProjectLocation, ProjectLocationDraft, ProjectLocationsActionResult, StoredProjectLocation } from '@jini-ai/ui-core';
export {
  DEFAULT_LOCATION_ID,
  externalLocations,
  isDuplicatePath,
  locationLabel,
  resolveDefaultLocationId,
  saveableDrafts,
  toStoredLocations,
} from '@jini-ai/ui-core';
export type { ProjectLocationsPort } from '@jini-ai/ui-core';
export { createFakeProjectLocationsPort } from '@jini-ai/ui-core';
export type { FakeProjectLocationsPortOptions } from '@jini-ai/ui-core';

export { useProjectLocationsTab } from './react/hooks/useProjectLocationsTab.js';
export type { UseProjectLocationsTabOptions, UseProjectLocationsTabResult } from './react/hooks/useProjectLocationsTab.js';
export { ProjectLocationsTab } from './react/components/ProjectLocationsTab.js';
export type { ProjectLocationsTabLabels, ProjectLocationsTabProps } from './react/components/ProjectLocationsTab.js';
