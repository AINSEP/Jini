/**
 * @file Provider-neutral contracts for the Commerce operational status read model.
 *
 * These contracts deliberately describe only facts the host can read today. Payment providers
 * remain opaque adapters identified by an open string; provider registration does not imply that
 * Commerce configuration, checkout, subscriptions, reconciliation, or revenue projections exist.
 */

import type { CommercePaymentProvider } from "@jini-ai/core/contracts/site/commerce";

export type CommerceCapabilityAvailability = "available" | "unavailable";

/** Operational checkout state supplied by the activated host, separate from provider discovery. */
export interface CommerceCheckoutReadiness {
  readonly active: boolean;
  readonly ready: boolean;
  readonly reason: string | null;
  /** Public callback address from trusted host configuration; never contains signing secrets. */
  readonly webhookUrl?: string | null;
  /** At most ten shop-owned order ids needing operator attention. */
  readonly needsAttention?: readonly string[];
}

export interface CommerceStatus {
  readonly contractVersion: 1;
  readonly workspaceId: string;
  readonly paymentRuntime: {
    readonly status: CommerceCapabilityAvailability;
    readonly reason: string | null;
  };
  readonly providers: readonly CommercePaymentProvider[];
  readonly checkout?: CommerceCheckoutReadiness;
  readonly configuration: {
    readonly status: "unavailable";
    readonly schema: null;
    readonly reason: string;
  };
  readonly capabilities: {
    readonly providerDiscovery: CommerceCapabilityAvailability;
    readonly checkout: CommerceCapabilityAvailability;
    readonly subscriptions: "unavailable";
    readonly webhookReconciliation: CommerceCapabilityAvailability;
    readonly revenue: "unavailable";
  };
}
