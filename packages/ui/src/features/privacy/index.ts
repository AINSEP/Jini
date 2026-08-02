export {
  generateInstallationId,
  hasMadeConsentDecision,
  isSharingEnabled,
  nextStateForDeclineAll,
  nextStateForDeleteMyData,
  nextStateForShareAll,
  nextStateForTelemetryPatch,
} from './rules.js';
export type { PrivacyConsentState, TelemetryPreferences } from './types.js';

export { PrivacyTab } from './react/components/PrivacyTab.js';
export type { PrivacyTabLabels, PrivacyTabProps } from './react/components/PrivacyTab.js';
