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

export interface CommerceStatus {
  readonly contractVersion: 1;
  readonly workspaceId: string;
  readonly paymentRuntime: {
    readonly status: CommerceCapabilityAvailability;
    readonly reason: string | null;
  };
  readonly providers: readonly CommercePaymentProvider[];
  readonly configuration: {
    readonly status: "unavailable";
    readonly schema: null;
    readonly reason: string;
  };
  readonly capabilities: {
    readonly providerDiscovery: CommerceCapabilityAvailability;
    readonly checkout: "unavailable";
    readonly subscriptions: "unavailable";
    readonly webhookReconciliation: "unavailable";
    readonly revenue: "unavailable";
  };
}
