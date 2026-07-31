import { describe, expect, it } from 'vitest';
import * as PrivacyBarrel from '../index.js';

describe('privacy tab barrel', () => {
  it('exports the rules functions and the PrivacyTab component', () => {
    expect(typeof PrivacyBarrel.generateInstallationId).toBe('function');
    expect(typeof PrivacyBarrel.hasMadeConsentDecision).toBe('function');
    expect(typeof PrivacyBarrel.isSharingEnabled).toBe('function');
    expect(typeof PrivacyBarrel.nextStateForDeclineAll).toBe('function');
    expect(typeof PrivacyBarrel.nextStateForDeleteMyData).toBe('function');
    expect(typeof PrivacyBarrel.nextStateForShareAll).toBe('function');
    expect(typeof PrivacyBarrel.nextStateForTelemetryPatch).toBe('function');
    expect(typeof PrivacyBarrel.PrivacyTab).toBe('function');
  });
});
