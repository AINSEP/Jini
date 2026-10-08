/**
 * @file The lipay payments-framework contracts (architecture review §4/§5).
 *
 * lipay is the payments FRAMEWORK plugin — the role WooCommerce itself plays, not the role one
 * gateway plays. Concrete gateways (the first-party `lipay` gateway in `providers/lipay-gateway.ts`,
 * and later Stripe/PayPal/regional systems) are `PaymentProvider` implementations registered into
 * it. Core never enumerates them.
 *
 * Three properties this file exists to make true, each traced to a failure in the systems the
 * architecture review studied:
 *   - `PaymentProviderId` is an OPEN string, not a closed union. Open SaaS's
 *     `id: "stripe" | "lemonsqueezy" | "polar"` (and this repo's own `DeployTarget`) make every new
 *     provider a core edit; Open SaaS's Paddle PR has to patch `| "paddle"` into the interface file.
 *   - Capabilities are a TYPED OBJECT, not WooCommerce's flat string array. WooCommerce's
 *     `$supports` is the mechanism that let a 2011 cheque gateway and a 2026 tokenizing card
 *     gateway coexist for 15 years; its untyped execution means a typo silently hides a button and
 *     partial support ("refunds, but only in full") is inexpressible.
 *   - `createCharge` returns THREE separate facts — did the call succeed (`ok`), did money move
 *     (`status`), what must the shopper do (`next`). WooCommerce collapsed all three into one
 *     string, where `'success'` for an off-site gateway means only "I produced a URL"; its own
 *     Store API later had to reintroduce `pending` as a fourth status to say what that really was.
 *
 * Discipline every implementation inherits from `deploy-plugin.ts` and may not break: no method
 * throws (every failure is a typed `PaymentError`), no method touches the database (core owns all
 * persistence and all idempotency), and all outbound HTTP goes through `ctx.httpClient` — the one
 * guarded ADR-038 seam — never a raw `fetch`.
 */
import type { HttpClientPort } from "@jini-ai/core/primitives";

export interface Money {
  /** Integer amount in the currency's minor unit. Never a float, never assumed to be /100. */
  readonly minorUnits: number;
  /** ISO-4217 alpha-3, uppercase. */
  readonly currency: string;
}

/**
 * Opaque, registry-keyed. DELIBERATELY NOT a closed string union — see the file header.
 * Constrained at registration time to ADR-026's plugin-identifier grammar so the id stays safe
 * as both a URL path segment (`/payments/webhook/:providerId`) and an env-var name fragment.
 */
export type PaymentProviderId = string;

export type ChargeNextActionKind =
  /** Captured synchronously (card-on-file, stored token). Rare. */
  | "none"
  /** Off-site hosted checkout: PayPal Standard, Stripe Checkout, Paystack redirect. */
  | "redirect"
  /** In-page SDK takes over: Paddle overlay, Stripe 3DS/Elements, Razorpay/Paystack inline. */
  | "client_action"
  /**
   * Shopper acts somewhere else entirely and the provider calls back later — minutes to days.
   * M-Pesa STK push, PIX, boleto bancário, bank transfer, USSD, agent/cash networks. This is the
   * DEFAULT mode across large parts of Africa, LATAM and South/Southeast Asia, which is why
   * neither WooCommerce's nor Open SaaS's redirect-shaped result could be reused here.
   */
  | "out_of_band";

export interface PaymentProviderCapabilities {
  /** WooCommerce's boolean `refunds` cannot express the middle value; this can. */
  readonly refunds: "none" | "full" | "partial";
  readonly tokenization: boolean;
  readonly recurring: boolean;
  /** Which completion shapes this provider can return from `createCharge`. */
  readonly confirmation: readonly ChargeNextActionKind[];
  /** ISO-4217 codes, or "any" when the provider accepts whatever the merchant account holds. */
  readonly currencies: readonly string[] | "any";
  /** False = this provider has no async callback; its charge result is final. */
  readonly webhooks: boolean;
}

export type PaymentErrorCode =
  | "NO_CREDENTIALS_CONFIGURED"
  | "PROVIDER_NOT_REGISTERED"
  | "CAPABILITY_UNSUPPORTED"
  | "CURRENCY_UNSUPPORTED"
  | "INVALID_REQUEST"
  | "DECLINED"
  | "TRANSPORT_ERROR"
  | "PROVIDER_ERROR"
  | "IDEMPOTENCY_CONFLICT"
  | "SIGNATURE_INVALID";

/** Mirrors `DeployError`'s shape — typed, never thrown — plus `retryable`. */
export interface PaymentError {
  readonly code: PaymentErrorCode;
  readonly message: string;
  readonly providerStatus?: (number) | undefined;
  /** True = retrying with the SAME idempotency key may succeed. */
  readonly retryable: boolean;
}

export type ChargeNextAction =
  | { readonly kind: "none" }
  | { readonly kind: "redirect"; readonly url: string }
  | {
      readonly kind: "client_action";
      readonly providerId: PaymentProviderId;
      /** Opaque blob handed to that provider's client SDK. */
      readonly payload: Readonly<Record<string, unknown>>;
    }
  | { readonly kind: "out_of_band"; readonly instructions?: (string) | undefined };

export interface ProviderContext {
  /**
   * Already resolved by core from `credentialKeys`, and scoped to THIS provider. Deliberate
   * deviation from `DeployTokenPort`, which hands every call site a port that can fetch ANY
   * target's token: pre-resolving means core performs the "not configured" check once, uniformly,
   * before entering provider code, and a provider cannot read a peer provider's credentials.
   */
  readonly credentials: Readonly<Record<string, string>>;
  /** The ADR-038 guarded seam. There is no other way to make an outbound call. */
  readonly httpClient: HttpClientPort;
  readonly now: () => number;
  /** Absolute, externally reachable URL this provider's webhooks arrive on. */
  readonly webhookUrl: string;
  /** Where the shopper returns after an off-site redirect. */
  readonly returnUrl: string;
}

export interface ProviderChargeInput {
  readonly amount: Money;
  /** Core-generated per attempt, stable across retries. Providers that support it MUST forward it. */
  readonly idempotencyKey: string;
  /** Caller's own domain reference — opaque to lipay and to the provider. */
  readonly reference?: (string) | undefined;
  readonly customer?: ({ readonly email?: (string) | undefined; readonly name?: (string) | undefined }) | undefined;
  /**
   * Provider-specific extras (M-Pesa needs a phone number; Razorpay a method hint). The escape
   * hatch that keeps rare provider needs OUT of the core input type — the seam that stops an
   * `lemonSqueezyCustomerPortalUrl`-style leak into a shared type.
   */
  readonly providerOptions?: (Readonly<Record<string, unknown>>) | undefined;
}

export type ProviderChargeResult =
  | {
      readonly ok: true;
      readonly providerRef: string;
      readonly status: "succeeded" | "pending";
      readonly next: ChargeNextAction;
    }
  | { readonly ok: false; readonly error: PaymentError };

export interface ProviderRefundInput {
  /** The provider's own charge reference the refund applies to. */
  readonly providerRef: string;
  readonly amount: Money;
  readonly idempotencyKey: string;
  readonly reason?: (string) | undefined;
}

export type ProviderRefundResult =
  | { readonly ok: true; readonly providerRef: string; readonly status: "succeeded" | "pending" }
  | { readonly ok: false; readonly error: PaymentError };

export interface ProviderWebhookInput {
  /** EXACT bytes as received. HMAC is computed over these. */
  readonly rawBody: Buffer;
  readonly headers: Readonly<Record<string, string>>;
}

export interface NormalizedPaymentEvent {
  /**
   * The provider's own event id — core's inbound idempotency key, and the reason Open SaaS's
   * replayed-`invoice.paid` double-credit-grant cannot occur here. A provider whose payloads
   * genuinely carry no event id MUST synthesize a deterministic one (e.g. a hash of the raw
   * body); it may not omit this field.
   */
  readonly providerEventId: string;
  /** Correlates to `p_lipay__payments.provider_ref` via the `ref` index. */
  readonly providerRef: string;
  readonly kind: "succeeded" | "failed" | "pending" | "refunded" | "chargeback" | "expired";
  readonly amount?: (Money) | undefined;
  /** Provider-reported event time, used for out-of-order rejection. */
  readonly occurredAt: number;
}

export type ProviderWebhookResult =
  | { readonly ok: true; readonly events: readonly NormalizedPaymentEvent[] }
  | { readonly ok: false; readonly error: PaymentError };

/**
 * One payment provider. Implemented once per provider, in its own file, and registered.
 * Core NEVER enumerates implementations of this interface.
 */
export interface PaymentProvider {
  readonly id: PaymentProviderId;
  readonly displayName: string;
  readonly capabilities: PaymentProviderCapabilities;

  /**
   * Credential slot names this provider needs, e.g. `["secretKey", "webhookSecret"]`. Core
   * resolves them and injects the resolved bundle as `ctx.credentials`. Declaring them as DATA —
   * rather than reading env vars inline — is what lets core report a misconfigured provider
   * uniformly, before any provider code runs.
   */
  readonly credentialKeys: readonly string[];

  createCharge(input: ProviderChargeInput, ctx: ProviderContext): Promise<ProviderChargeResult>;

  /** Present only when `capabilities.refunds !== "none"`. Core checks before calling. */
  refund?(input: ProviderRefundInput, ctx: ProviderContext): Promise<ProviderRefundResult>;

  /**
   * Verify and normalize an inbound webhook. Returns DOMAIN EVENTS; core writes them.
   *
   * This is Medusa's `getWebhookActionAndData` inversion, and deliberately NOT Open SaaS's
   * `webhook: PaymentsWebhook` (which hands the provider an entire Express handler and lets it
   * write to the database itself). Consequences: the raw-body problem is solved ONCE in core, so
   * no per-provider middleware hook is needed; idempotency is enforced by core rather than by each
   * provider author's discipline; and a provider physically cannot write a row core did not
   * authorize.
   *
   * Async, and given `ctx.httpClient`, because some providers verify out-of-band rather than by
   * local HMAC — WooCommerce's PayPal IPN handler posts the notification back to PayPal. A
   * synchronous signature would have excluded PayPal.
   */
  parseWebhook(input: ProviderWebhookInput, ctx: ProviderContext): Promise<ProviderWebhookResult>;
}

/**
 * Providers add themselves; core never enumerates them. This is the one thing WooCommerce's
 * `woocommerce_payment_gateways` filter got right, minus its class-name-strings-and-`new $gateway()`
 * execution.
 */
export interface PaymentProviderRegistry {
  register(required: { provider: PaymentProvider }, optional?: Record<string, never>): void;
  get(required: { id: PaymentProviderId }, optional?: Record<string, never>): PaymentProvider | null;
  list(required?: Record<string, never>, optional?: Record<string, never>): readonly PaymentProvider[];
}

/**
 * Resolves the full credential BUNDLE for one provider.
 *
 * Deliberate deviation from `DeployTokenPort.getToken(target): Promise<string | null>`: a single
 * opaque string cannot hold what a payment provider needs. Stripe needs a secret key AND a webhook
 * signing secret; Lemon Squeezy needs an API key, a webhook secret and a store ID; M-Pesa needs a
 * consumer key, consumer secret, shortcode and passkey. Returning one string would force every
 * provider to invent its own delimiter-packing convention.
 *
 * `workspaceId` is carried NOW even though the shipped env-var adapter resolves credentials
 * install-wide: per-workspace merchant credentials are a real multi-tenant requirement (ADR-007 §1
 * — "every method carries `workspaceId`"), and adding the parameter after this port has consumers
 * is expensive under ADR-005's semver promise. Cheap now, expensive later.
 */
export interface PaymentCredentialsPort {
  getCredentials(
    required: {
      readonly workspaceId: string;
      readonly providerId: PaymentProviderId;
      readonly keys: readonly string[];
    },
    optional?: Record<string, never>
  ): Promise<Readonly<Record<string, string>> | null>;
}
