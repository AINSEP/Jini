export type { PrivacyConsentState, TelemetryPreferences } from './types.js';
export {
  generateInstallationId,
  hasMadeConsentDecision,
  isSharingEnabled,
  nextStateForDeclineAll,
  nextStateForDeleteMyData,
  nextStateForShareAll,
  nextStateForTelemetryPatch,
} from './rules.js';
