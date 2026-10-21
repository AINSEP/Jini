/**
 * @file What the payments operations (lot L4) are built from. Every dependency is injected: the
 * ledger, the provider registry, the host's credential/context resolver, the grant store, the
 * clock and the id source; the risk gate and the alert sink are optional.
 */
import { noopAlertPort, type PaymentsAlertPort } from "../contract/alerts.js";
import type { RiskGateDeps } from "../contract/risk.js";
import type { WriterDeps } from "../accounting/apply-evidence.js";
import type { PaymentsLedger } from "../ledger/repo.js";
import type { KernelProviderRegistry, ProviderContextPort } from "../provider-registry.js";
import type { MoneyGrantPort } from "./grants.js";

export interface PaymentsServiceRequired {
  readonly ledger: PaymentsLedger;
  readonly providers: KernelProviderRegistry;
  readonly contexts: ProviderContextPort;
  readonly grants: MoneyGrantPort;
  readonly now: () => number;
  /** Globally unique ids (payment, refund, attempt, evidence rows). */
  readonly newId: () => string;
}

export interface PaymentsServiceOptional {
  /** The pre-charge risk gate (port, deadline, fail policy, timer). Absent = every intent is allowed. */
  readonly risk?: RiskGateDeps;
  /** Stuck-money alerts (over-withdrawn, unknown-aged, quarantine). Absent = dropped. */
  readonly alerts?: PaymentsAlertPort;
}

/** The resolved dependency set every operation receives. */
export interface OpsDeps extends PaymentsServiceRequired {
  readonly risk: RiskGateDeps | null;
  readonly alerts: PaymentsAlertPort;
  /** What the single writer gets: the same clock, ids and alert sink. */
  readonly writer: WriterDeps;
}

export function resolveOpsDeps(required: PaymentsServiceRequired, optional: PaymentsServiceOptional = {}): OpsDeps {
  const alerts = optional.alerts ?? noopAlertPort;
  return {
    ...required, risk: optional.risk ?? null, alerts,
    writer: { now: required.now, newId: required.newId, alerts },
  };
}
