/**
 * @file Provider-neutral payment-provider discovery shapes for the Commerce operational status read
 * model. Types only; this module owns the declarations that `@jini-ai/commerce`
 * (`catalog/contracts.ts`) used to declare. That package imports them from here and keeps its
 * runtime values.
 *
 * Payment providers remain opaque adapters identified by an open string; provider registration does
 * not imply that Commerce configuration, checkout, subscriptions, reconciliation, or revenue
 * projections exist.
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
