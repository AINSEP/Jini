/**
 * @file Stuck-money alerts (gap check item 6). The kernel never CAPS or silently fixes money facts
 * it does not like; it records them and raises an alert so a person looks. Injected; the default
 * drops alerts, so a host that wants them must bind a real port.
 */
import type { PaymentMode } from "./scope.js";

export type PaymentsAlertKind =
  /** Succeeded refunds + disputed money exceed what was captured (owner 2026-10-21: alert, never cap). */
  | "over-withdrawn"
  /** A payment or refund has been `unknown` longer than the host's threshold. */
  | "unknown-aged"
  /** A webhook inbox row was dead-lettered. */
  | "inbox-dead-letter"
  /** Evidence was quarantined. */
  | "quarantine";

export interface PaymentsAlert {
  readonly kind: PaymentsAlertKind;
  readonly workspaceId: string;
  readonly mode: PaymentMode;
  readonly paymentId: string | null;
  /** Human-readable; never carries personal data or secrets. */
  readonly detail: string;
}

export interface PaymentsAlertPort {
  raise(required: { alert: PaymentsAlert }, optional?: Record<string, never>): Promise<void>;
}

export const noopAlertPort: PaymentsAlertPort = { raise: async () => undefined };
