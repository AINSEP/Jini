export type { PrivacyConsentState, TelemetryPreferences } from '@jini-ai/ui-core';
export {
  generateInstallationId,
  hasMadeConsentDecision,
  isSharingEnabled,
  nextStateForDeclineAll,
  nextStateForDeleteMyData,
  nextStateForShareAll,
  nextStateForTelemetryPatch,
} from '@jini-ai/ui-core';

export { PrivacyTab } from './react/components/PrivacyTab.js';
export type { PrivacyTabLabels, PrivacyTabProps } from './react/components/PrivacyTab.js';
