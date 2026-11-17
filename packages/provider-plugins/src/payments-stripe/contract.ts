/**
 * Structural copy of the `commerce` payments provider port (`@jini-ai/commerce/payments/kernel`); the drift guard
 * (`__tests__/contract-drift.typecheck.ts`) proves the fit in both directions. A plugin cannot import the domain
 * package, so the members this provider reads or returns are restated here field for field.
 * A provider is a stateless translator: it writes no rows, owns no idempotency and calls out only through `ctx.httpClient`.
 */
import type { HttpClientPort } from "@jini-ai/core/primitives";

export interface Money {
  /** Integer amount in the currency's minor unit. Never a float, never assumed to be /100. */
  readonly minorUnits: number;
  /** ISO-4217 alpha-3, UPPERCASE. */
  readonly currency: string;
}

export type PaymentMode = "test" | "live";
export type ProviderAccountScope = { readonly providerAccountId: string; readonly mode: PaymentMode };

/** The provider's view of a payment intent. `unknown` is never evidence: it is OUR state when we could not tell. */
export type ProviderPaymentStatus = "pending" | "requires_action" | "authorized" | "succeeded" | "failed" | "canceled";
export type ProviderRefundStatus = "pending" | "succeeded" | "failed";
/** `won` returns the money; `lost` keeps it withdrawn. */
export type ProviderDisputeStatus = "open" | "won" | "lost";
export type NextActionKind = "none" | "redirect" | "client_action" | "out_of_band";

/** What the shopper must do next. */
export type NextAction =
  | { readonly kind: "none" }
  | { readonly kind: "redirect"; readonly url: string }
  | { readonly kind: "client_action"; readonly payload: Readonly<Record<string, unknown>> }
  | { readonly kind: "out_of_band"; readonly instructions?: string };

export interface RefundEvidence {
  readonly providerRefundRef: string;
  readonly correlationId?: string;
  readonly amount: Money;
  readonly status: ProviderRefundStatus;
}

export interface DisputeEvidence {
  readonly providerDisputeRef: string;
  readonly amount: Money;
  readonly status: ProviderDisputeStatus;
  /** Epoch ms by which evidence must be submitted, when the provider says. */
  readonly dueBy?: number;
}

export interface SettlementEvidence {
  readonly fee?: Money;
  readonly net?: Money;
  readonly settlement?: Money;
}

export interface PaymentEvidence {
  /** The provider's payment / intent id. */
  readonly providerRef: string;
  /** OUR payment id, when the provider echoes it. */
  readonly correlationId?: string;
  readonly status: ProviderPaymentStatus;
  /** What the provider authorized/charged, when it says. Checked against our amount; a mismatch is quarantined. */
  readonly amount?: Money;
  readonly captured?: Money;
  readonly next?: NextAction;
  readonly settlement?: SettlementEvidence;
  /** Missing refunds are NEVER deleted. */
  readonly refunds: readonly RefundEvidence[];
  readonly disputes: readonly DisputeEvidence[];
}

/** One verified webhook fact; `evidence` is absent when the event carries ids only (the worker then calls `retrieve`). */
export interface WebhookFact {
  readonly providerEventId: string;
  readonly providerRef: string;
  readonly occurredAt?: number;
  readonly evidence?: PaymentEvidence;
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
  | "SIGNATURE_INVALID"
  | "RISK_DENIED"
  | "GRANT_INVALID";

/** Typed, never thrown. `retryable` = retrying with the SAME idempotency key may succeed. */
export interface PaymentError {
  readonly code: PaymentErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly providerStatus?: number;
}

export type Outcome<T> =
  | { readonly kind: "ok"; readonly value: T }
  /** The provider PROVABLY moved no money (a decline, a validation error). Safe to mark failed. */
  | { readonly kind: "rejected"; readonly error: PaymentError }
  /** Money MAY have moved (timeout, 5xx, dropped connection). Never `failed`: reconcile instead. */
  | { readonly kind: "unknown"; readonly error: PaymentError };

export interface ProviderCapabilities {
  readonly refunds: "none" | "full" | "partial";
  readonly capture: "auto" | "manual";
  readonly void: boolean;
  readonly disputes: boolean;
  readonly retrieve: "none" | "payment" | "payment+refunds";
  readonly echoesCorrelation: boolean;
  readonly confirmation: readonly NextActionKind[];
  /** UPPERCASE ISO-4217 codes, or `any`. */
  readonly currencies: readonly string[] | "any";
}

export interface ProviderContext {
  /** Resolved by the kernel from `credentialKeys` for THIS provider account + mode only. */
  readonly credentials: Readonly<Record<string, string>>;
  readonly account: ProviderAccountScope;
  readonly httpClient: HttpClientPort;
  readonly now: () => number;
  readonly webhookUrl: string;
  readonly returnUrl: string;
  readonly cancelUrl: string;
}

export interface IntentLine {
  /** Display only; never personal data. */
  readonly description: string;
  readonly quantity: number;
  readonly unitAmount: Money;
  readonly providerPriceRef?: string;
}

export interface IntentRequest {
  readonly amount: Money;
  readonly line?: IntentLine;
  readonly idempotencyKey: string;
  /** OUR payment id, sent so the provider can echo it. */
  readonly correlationId: string;
  readonly captureMode: "auto" | "manual";
  readonly partyId?: string;
  readonly providerOptions?: Readonly<Record<string, unknown>>;
}

export interface RefundRequest {
  readonly providerRef: string;
  readonly amount: Money;
  readonly idempotencyKey: string;
  readonly correlationId: string;
}

export interface PaymentProvider {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: ProviderCapabilities;
  /** Credential slot names (`secretKey`, `webhookSecret`); the kernel resolves them before any call. */
  readonly credentialKeys: readonly string[];
  /** Opt-in: replaying the identical intent key/request is safe for this many milliseconds. */
  readonly intentReplayWindowMs?: number;
  createIntent(
    required: { req: IntentRequest; ctx: ProviderContext },
    optional?: { signal?: AbortSignal }
  ): Promise<Outcome<{ readonly evidence: PaymentEvidence; readonly next: NextAction }>>;
  refund?(
    required: { req: RefundRequest; ctx: ProviderContext },
    optional?: { reason?: string; signal?: AbortSignal }
  ): Promise<Outcome<RefundEvidence>>;
  capture?(
    required: { req: { providerRef: string; amount: Money; idempotencyKey: string }; ctx: ProviderContext },
    optional?: { signal?: AbortSignal }
  ): Promise<Outcome<PaymentEvidence>>;
  void?(
    required: { req: { providerRef: string; idempotencyKey: string }; ctx: ProviderContext },
    optional?: { signal?: AbortSignal }
  ): Promise<Outcome<PaymentEvidence>>;
  retrieve?(
    required: { providerRef: string; ctx: ProviderContext },
    optional?: { signal?: AbortSignal }
  ): Promise<Outcome<PaymentEvidence>>;
  /** Verify the signature over the EXACT raw bytes and translate to facts; never throws. */
  verifyWebhook(
    required: { rawBody: Uint8Array; headers: Readonly<Record<string, string>>; ctx: ProviderContext },
    optional?: Record<string, never>
  ): Promise<Outcome<readonly WebhookFact[]>>;
}

/**
 * The commerce helpers the domain hands every payment provider as the factory's `optional.context` (flat, by name).
 * The provider never copies their bodies: their error codes and money rules are the domain's contract.
 */
export interface StripeProviderContext {
  readonly paymentError: (
    required: { code: PaymentErrorCode; message: string },
    optional?: { retryable?: boolean; providerStatus?: number }
  ) => PaymentError;
  /** Why a value is not valid Money, or `null` when it is; `allowZero` exists for prices. */
  readonly moneyProblem: (required: { money: Money }, optional?: { allowZero?: boolean }) => string | null;
}
