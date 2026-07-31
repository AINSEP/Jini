import { randomUUID } from '../../utils/uuid.js';
import type { PrivacyConsentState, TelemetryPreferences } from './types.js';

/** A fresh anonymous, non-PII installation id. */
export function generateInstallationId(): string {
  return randomUUID();
}

/** `privacyDecisionAt` gates whether the consent card renders as "decided"
 *  (showing the per-category toggles + installation id) vs. a first-run
 *  prompt (share/decline only). */
export function hasMadeConsentDecision(state: Pick<PrivacyConsentState, 'privacyDecisionAt'>): boolean {
  return state.privacyDecisionAt != null;
}

/** `true` once telemetry sharing exists in any real form (either signal
 *  on) — drives the consent card's "share"/"decline" active-state pill. */
export function isSharingEnabled(telemetry: TelemetryPreferences): boolean {
  return telemetry.metrics === true || telemetry.content === true;
}

function shouldHaveInstallationId(telemetry: TelemetryPreferences): boolean {
  return Object.values(telemetry).some((v) => v === true);
}

/**
 * Pure transition for toggling one telemetry category. Mirrors the
 * install-id lifecycle rule from the origin: an id exists exactly while at
 * least one category is on, generated on first opt-in and cleared (not
 * reused) once every category is off again.
 */
export function nextStateForTelemetryPatch(
  state: PrivacyConsentState,
  patch: Partial<TelemetryPreferences>,
  now: number,
  newInstallationId: () => string = generateInstallationId,
): PrivacyConsentState {
  const nextTelemetry = { ...state.telemetry, ...patch };
  const wantsId = shouldHaveInstallationId(nextTelemetry);
  return {
    ...state,
    installationId: wantsId ? (state.installationId ?? newInstallationId()) : null,
    privacyDecisionAt: now,
    telemetry: nextTelemetry,
  };
}

/** Pure transition for the consent card's "Share usage" action — opts into
 *  both categories at once. */
export function nextStateForShareAll(
  state: PrivacyConsentState,
  now: number,
  newInstallationId: () => string = generateInstallationId,
): PrivacyConsentState {
  return {
    ...state,
    installationId: state.installationId ?? newInstallationId(),
    privacyDecisionAt: now,
    telemetry: { ...state.telemetry, metrics: true, content: true },
  };
}

/** Pure transition for the consent card's "Don't share" action — declines
 *  both categories at once. */
export function nextStateForDeclineAll(state: PrivacyConsentState, now: number): PrivacyConsentState {
  return {
    ...state,
    installationId: null,
    privacyDecisionAt: now,
    telemetry: { ...state.telemetry, metrics: false, content: false },
  };
}

/**
 * Pure transition for "Delete my data": rotates to a fresh installation id
 * (so any prior reporting history is orphaned) while turning both telemetry
 * categories off, without disturbing whether the user has "made a decision"
 * at all (an already-decided user stays decided).
 */
export function nextStateForDeleteMyData(
  state: PrivacyConsentState,
  now: number,
  newInstallationId: () => string = generateInstallationId,
): PrivacyConsentState {
  return {
    ...state,
    installationId: newInstallationId(),
    privacyDecisionAt: state.privacyDecisionAt ?? now,
    telemetry: { metrics: false, content: false },
  };
}
