/**
 * @file Provider-neutral contracts for the Commerce operational status read model.
 *
 * These contracts deliberately describe only facts the host can read today. Payment providers
 * remain opaque adapters identified by an open string; provider registration does not imply that
 * Commerce configuration, checkout, subscriptions, reconciliation, or revenue projections exist.
 */

export type CommercePaymentConfirmation =
  | "none"
  | "redirect"
  | "client_action"
  | "out_of_band";

export interface CommercePaymentProviderCapabilities {
  readonly refunds: "none" | "full" | "partial";
  readonly tokenization: boolean;
  readonly recurring: boolean;
  readonly confirmation: readonly CommercePaymentConfirmation[];
  readonly currencies: readonly string[] | "any";
  readonly webhooks: boolean;
}

export interface CommercePaymentProvider {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: CommercePaymentProviderCapabilities;
}

/**
 * Narrow read port satisfied structurally by the host's optional payment runtime.
 *
 * The port intentionally excludes charge, refund, webhook, payment-record, and credential
 * methods. A Commerce status request therefore cannot move money, process an event, read a secret,
 * or manufacture a revenue projection through this boundary.
 */
export interface CommercePaymentRuntimePort {
  listProviders(): readonly CommercePaymentProvider[];
}

export type CommerceCapabilityAvailability = "available" | "unavailable";

/** Operational checkout state supplied by the activated host, separate from provider discovery. */
export interface CommerceCheckoutReadiness {
  readonly active: boolean;
  readonly ready: boolean;
  readonly reason: string | null;
  /** Public callback address from trusted host configuration; never contains signing secrets. */
  readonly webhookUrl?: string | null;
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
