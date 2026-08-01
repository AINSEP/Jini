export type { SettingsDialogChromeLabels, SettingsDialogTabMeta } from './types.js';
export { findActiveTab, resolveInitialActiveTabId } from './rules.js';
export { randomUUID } from './utils/uuid.js';
export {
  isAllowedEndpointUrl,
  isBlockedEndpointHost,
  isLoopbackEndpointHost,
} from './utils/endpoint-policy.js';
export type { IconName } from './icon-name.js';
export type { SoundId, SoundOption } from './notifications-catalog.js';
export {
  DEFAULT_FAILURE_SOUND_ID,
  DEFAULT_SUCCESS_SOUND_ID,
  FAILURE_SOUNDS,
  SUCCESS_SOUNDS,
} from './notifications-catalog.js';

export * from './features/about/index.js';
export * from './features/appearance/index.js';
export * from './features/execution/index.js';
export * from './features/integrations/index.js';
export * from './features/language/index.js';
export * from './features/media-providers/index.js';
export * from './features/notifications/index.js';
export * from './features/privacy/index.js';
export * from './features/project-locations/index.js';
export * from './features/skills/index.js';

export * from './features/connectors/index.js';
export * from './features/source-config-list/index.js';
export * from './features/memory/index.js';
