import { describe, expect, it } from 'vitest';
import {
  generateInstallationId,
  hasMadeConsentDecision,
  isSharingEnabled,
  nextStateForDeclineAll,
  nextStateForDeleteMyData,
  nextStateForShareAll,
  nextStateForTelemetryPatch,
} from '../../../tabs/privacy/rules.js';
import type { PrivacyConsentState } from '../../../tabs/privacy/types.js';

const NOW = 1_700_000_000_000;
const fixedId = () => 'fixed-id';

function baseState(overrides: Partial<PrivacyConsentState> = {}): PrivacyConsentState {
  return {
    telemetry: {},
    installationId: null,
    privacyDecisionAt: null,
    ...overrides,
  };
}

describe('generateInstallationId', () => {
  it('returns a non-empty string', () => {
    expect(generateInstallationId().length).toBeGreaterThan(0);
  });

  it('returns different ids across calls', () => {
    expect(generateInstallationId()).not.toBe(generateInstallationId());
  });
});

describe('hasMadeConsentDecision', () => {
  it('is false before any decision', () => {
    expect(hasMadeConsentDecision({ privacyDecisionAt: null })).toBe(false);
  });

  it('is true once a decision timestamp exists', () => {
    expect(hasMadeConsentDecision({ privacyDecisionAt: NOW })).toBe(true);
  });
});

describe('isSharingEnabled', () => {
  it('is false when neither category is on', () => {
    expect(isSharingEnabled({})).toBe(false);
    expect(isSharingEnabled({ metrics: false, content: false })).toBe(false);
  });

  it('is true when either category is on', () => {
    expect(isSharingEnabled({ metrics: true })).toBe(true);
    expect(isSharingEnabled({ content: true })).toBe(true);
  });
});

describe('nextStateForTelemetryPatch', () => {
  it('generates a fresh installation id on first opt-in', () => {
    const next = nextStateForTelemetryPatch(baseState(), { metrics: true }, NOW, fixedId);
    expect(next.installationId).toBe('fixed-id');
    expect(next.privacyDecisionAt).toBe(NOW);
    expect(next.telemetry).toEqual({ metrics: true });
  });

  it('keeps the existing installation id when already opted in', () => {
    const state = baseState({ telemetry: { metrics: true }, installationId: 'existing-id' });
    const next = nextStateForTelemetryPatch(state, { content: true }, NOW, fixedId);
    expect(next.installationId).toBe('existing-id');
  });

  it('clears the installation id once every category is off', () => {
    const state = baseState({ telemetry: { metrics: true, content: true }, installationId: 'existing-id' });
    const next = nextStateForTelemetryPatch(state, { metrics: false, content: false }, NOW, fixedId);
    expect(next.installationId).toBeNull();
  });
});

describe('nextStateForShareAll', () => {
  it('opts into both categories and generates an id', () => {
    const next = nextStateForShareAll(baseState(), NOW, fixedId);
    expect(next.telemetry).toEqual({ metrics: true, content: true });
    expect(next.installationId).toBe('fixed-id');
    expect(next.privacyDecisionAt).toBe(NOW);
  });

  it('does not regenerate an existing installation id', () => {
    const state = baseState({ installationId: 'existing-id' });
    const next = nextStateForShareAll(state, NOW, fixedId);
    expect(next.installationId).toBe('existing-id');
  });
});

describe('nextStateForDeclineAll', () => {
  it('turns both categories off and clears the installation id', () => {
    const state = baseState({ telemetry: { metrics: true, content: true }, installationId: 'existing-id' });
    const next = nextStateForDeclineAll(state, NOW);
    expect(next.telemetry).toEqual({ metrics: false, content: false });
    expect(next.installationId).toBeNull();
    expect(next.privacyDecisionAt).toBe(NOW);
  });
});

describe('nextStateForDeleteMyData', () => {
  it('rotates the installation id and turns both categories off', () => {
    const state = baseState({ telemetry: { metrics: true, content: true }, installationId: 'existing-id' });
    const next = nextStateForDeleteMyData(state, NOW, fixedId);
    expect(next.installationId).toBe('fixed-id');
    expect(next.telemetry).toEqual({ metrics: false, content: false });
  });

  it('preserves an already-made decision timestamp instead of overwriting it', () => {
    const state = baseState({ privacyDecisionAt: 1 });
    const next = nextStateForDeleteMyData(state, NOW, fixedId);
    expect(next.privacyDecisionAt).toBe(1);
  });

  it('sets a decision timestamp if one did not exist yet', () => {
    const state = baseState({ privacyDecisionAt: null });
    const next = nextStateForDeleteMyData(state, NOW, fixedId);
    expect(next.privacyDecisionAt).toBe(NOW);
  });
});
