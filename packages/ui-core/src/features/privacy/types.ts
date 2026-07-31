/**
 * Origin: `PrivacySection.tsx`, mounted by `SettingsDialog.tsx`'s `privacy`
 * tab. r6 §1.3 flagged this "likely generic, not fully verified" — a
 * telemetry-consent card (share/decline + two per-category toggles) over a
 * generic `{ metrics, content }` shape, plus an installation-id
 * generate/rotate flow. Verified generic for this task (see
 * `packages/ui/source-map.md` for the full note): the only OD coupling was
 * the `AppConfig`/`TelemetryConfig` type import (replaced by the local
 * types below) and the analytics tracking calls (dropped, same as every
 * other tab in this feature).
 */

export interface TelemetryPreferences {
  metrics?: boolean;
  content?: boolean;
}

export interface PrivacyConsentState {
  telemetry: TelemetryPreferences;
  /** Anonymous, non-PII installation id. `null` while telemetry sharing is
   *  fully declined. */
  installationId: string | null;
  /** Epoch ms of the most recent consent decision, or `null` before the
   *  user has made one at all (gates whether the consent card's two actions
   *  render as "decided" vs. a first-run prompt). */
  privacyDecisionAt: number | null;
}
