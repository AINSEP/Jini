import { PRIVACY_NAMESPACE } from "@jini-ai/core/settings";
import { readBoolean, readNumber, readString, type LedgerCandidate } from "./ledger-slice.js";
import type { createSettingsTabs } from "./settings-tabs.js";

const WORKSPACE_SCOPE = "workspace";

// --- Privacy --------------------------------------------------------------

const PRIVACY_KEYS = {
  metrics: "telemetry.metrics",
  content: "telemetry.content",
  installationId: "installationId",
  decisionAt: "decisionAt",
} as const;

/** Mirrors `ui-tab-definitions.ts`'s identical sentinels: the ledger cannot
 *  register a null default for a non-secret definition, and both of these
 *  fields are nullable in `@jini-ai/ui`'s own type. */
const NO_DECISION_SENTINEL = 0;
const NO_INSTALLATION_ID_SENTINEL = "";


export async function loadPrivacy({ deps }: { deps: Parameters<typeof createSettingsTabs>[0]["deps"] }, _optional = {}): Promise<{ telemetry: { metrics?: boolean; content?: boolean }; installationId: string | null; privacyDecisionAt: number | null }> {
  const values = await deps.loadNamespaceValues({ namespace: PRIVACY_NAMESPACE });
  const decisionAt = readNumber({ values, key: PRIVACY_KEYS.decisionAt, fallback: NO_DECISION_SENTINEL });
  const installationId = readString({ values, key: PRIVACY_KEYS.installationId, fallback: NO_INSTALLATION_ID_SENTINEL });
  return {
    telemetry: {
      metrics: readBoolean({ values, key: PRIVACY_KEYS.metrics, fallback: false }),
      content: readBoolean({ values, key: PRIVACY_KEYS.content, fallback: false }),
    },
    // Both sentinels collapse back to the `null` the tab uses to mean "absent".
    // `decisionAt` gates the first-run consent prompt, so getting this wrong in
    // either direction is user-visible: a stuck prompt, or a silently-skipped one.
    installationId: installationId === NO_INSTALLATION_ID_SENTINEL ? null : installationId,
    privacyDecisionAt: decisionAt === NO_DECISION_SENTINEL ? null : decisionAt,
  };
}

/** Map optional privacy preferences to the existing ledger sentinels. O(1); no effects. */
function privacyLedgerValues({ state }: { state: { telemetry: { metrics?: boolean; content?: boolean }; installationId: string | null; privacyDecisionAt: number | null } }, _options = {}) {
  return { metrics: state.telemetry.metrics ?? false, content: state.telemetry.content ?? false,
    installationId: state.installationId ?? NO_INSTALLATION_ID_SENTINEL,
    decisionAt: state.privacyDecisionAt ?? NO_DECISION_SENTINEL };
}

export async function savePrivacy({ next, previous, deps }: { next: { telemetry: { metrics?: boolean; content?: boolean }; installationId: string | null; privacyDecisionAt: number | null }; previous: { telemetry: { metrics?: boolean; content?: boolean }; installationId: string | null; privacyDecisionAt: number | null }; deps: Parameters<typeof createSettingsTabs>[0]["deps"] }, _optional = {}): Promise<readonly string[]> {
  const nextValues = privacyLedgerValues({ state: next }), previousValues = privacyLedgerValues({ state: previous });
  const { metrics: nextMetrics, content: nextContent, installationId: nextInstallationId, decisionAt: nextDecisionAt } = nextValues;
  const { metrics: previousMetrics, content: previousContent, installationId: previousInstallationId, decisionAt: previousDecisionAt } = previousValues;

  const candidates: LedgerCandidate[] = [
    { key: PRIVACY_KEYS.metrics, valueJson: nextMetrics, changed: nextMetrics !== previousMetrics },
    { key: PRIVACY_KEYS.content, valueJson: nextContent, changed: nextContent !== previousContent },
    {
      key: PRIVACY_KEYS.installationId,
      valueJson: nextInstallationId,
      changed: nextInstallationId !== previousInstallationId,
    },
    {
      key: PRIVACY_KEYS.decisionAt,
      valueJson: nextDecisionAt,
      changed: nextDecisionAt !== previousDecisionAt,
    },
  ];
  // A withdrawal stops live browser collection even when the durable save fails.
  // Keep only a denial marker for reloads; it can never manufacture a grant.
  if (!nextMetrics && previousMetrics) deps.onMetricsWithdrawal();
  // Metrics is the first durable write. Signal it before later preference writes can fail.
  const metrics = await deps.saveChangedEntries({ namespace: PRIVACY_NAMESPACE, scope: WORKSPACE_SCOPE, candidates: candidates.filter(candidate => candidate.key === PRIVACY_KEYS.metrics) });
  if (metrics.includes(PRIVACY_KEYS.metrics)) deps.onMetricsSaved({ metrics: nextMetrics });
  const remaining = await deps.saveChangedEntries({ namespace: PRIVACY_NAMESPACE, scope: WORKSPACE_SCOPE, candidates: candidates.filter(candidate => candidate.key !== PRIVACY_KEYS.metrics) });
  return [...metrics, ...remaining];
}

