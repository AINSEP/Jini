export { createFakeMediaProvidersPort, type FakeMediaProvidersPortOptions } from './dependencies.js';
export type { MediaProvidersPort } from './ports.js';
export {
  hasAnyConfiguredProvider,
  hasRecoverableFields,
  isEntryEmpty,
  isEntryPresent,
  isMarkerOnlyEntry,
  maskedKeyLabel,
  mergeDaemonProviders,
  resolveProviderBaseUrl,
  shouldSyncLocalProvidersToDaemon,
  sortProvidersByConfigured,
} from './rules.js';
export type {
  MediaProviderCredentials,
  MediaProviderMap,
  MediaProviderOption,
  MediaProvidersLoadState,
  MediaProvidersSaveState,
} from './types.js';

export { useMediaProvidersTab } from './react/hooks/useMediaProvidersTab.js';
export type {
  MediaProviderEditPatch,
  UseMediaProvidersTabOptions,
  UseMediaProvidersTabResult,
} from './react/hooks/useMediaProvidersTab.js';
export { MediaProvidersTab } from './react/components/MediaProvidersTab.js';
export type { MediaProvidersTabLabels, MediaProvidersTabProps } from './react/components/MediaProvidersTab.js';
