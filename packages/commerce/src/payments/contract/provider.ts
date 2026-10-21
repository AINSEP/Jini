/**
 * @file The payment PROVIDER contract (commerce design 2026-10-21, converged R3). Replaces
 * `payments/ports.ts` once `lipay-plugin.ts` is split (L4); both coexist until then.
 *
 * A provider plugin (Stripe, PayPal, LiPay) is a stateless TRANSLATOR: it turns our requests into
 * provider calls and provider responses/webhooks into evidence. It writes no rows, owns no
 * idempotency and makes outbound calls only through `ctx.httpClient` (the ADR-038 seam).
 *
 * Every call returns an `Outcome` with THREE cases instead of ok/error, because "the call failed"
 * and "no money moved" are different facts: a timeout may have charged the card. Today's code
 * mapped every provider error to terminal `failed` (`lipay-plugin.ts:654-658`) and then ignored the
 * late success webhook (bug B4). `unknown` keeps the money reserved until a reconcile settles it.
 *
 * The contract is deliberately minimal (Opus R3): capture/void/retrieve are optional and declared
 * by `capabilities`; grow it only when a real adapter cannot be built against it.
 */
import type { HttpClientPort } from "@jini-ai/core/primitives";
import type { Money } from "../../money/money.js";
import type { NextAction, NextActionKind, PaymentEvidence, RefundEvidence, WebhookFact } from "./evidence.js";
import type { ProviderAccountScope } from "./scope.js";

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
  /** A money-moving call's grant was missing, expired, already used or bound to something else (design item 8). */
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
  /** `full` = refunds only of the whole captured amount. */
  readonly refunds: "none" | "full" | "partial";
  /** `manual` = `createIntent` may authorize only; `capture` must exist. */
  readonly capture: "auto" | "manual";
  readonly void: boolean;
  readonly disputes: boolean;
  /** What `retrieve` can return; `none` = no `retrieve` method. */
  readonly retrieve: "none" | "payment" | "payment+refunds";
  /** Whether the provider echoes our correlation id on refunds/webhooks (matched first in L3). */
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
  /** Absolute webhook URL for this site + account (site in the path, gap check item 1). */
  readonly webhookUrl: string;
  readonly returnUrl: string;
}

export interface IntentRequest {
  readonly amount: Money;
  /** Kernel-generated, stable across retries; forwarded to providers that support one. */
  readonly idempotencyKey: string;
  /** OUR payment id, sent so the provider can echo it. */
  readonly correlationId: string;
  readonly captureMode: "auto" | "manual";
  /** Opaque party id only — no names/emails/IPs in money paths (gap check item 4). */
  readonly partyId?: string;
  /** Provider-specific extras (an M-Pesa phone number) kept out of the core type. */
  readonly providerOptions?: Readonly<Record<string, unknown>>;
}

export interface RefundRequest {
  readonly providerRef: string;
  readonly amount: Money;
  readonly idempotencyKey: string;
  /** OUR refund id. Providers that can echo it MUST. */
  readonly correlationId: string;
}

export interface PaymentProvider {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: ProviderCapabilities;
  /** Credential slot names (`secretKey`, `webhookSecret`); the kernel resolves them before any call. */
  readonly credentialKeys: readonly string[];
  createIntent(
    required: { req: IntentRequest; ctx: ProviderContext },
    optional?: { signal?: AbortSignal }
  ): Promise<Outcome<{ readonly evidence: PaymentEvidence; readonly next: NextAction }>>;
  /** Present iff `capabilities.refunds !== "none"`. */
  refund?(
    required: { req: RefundRequest; ctx: ProviderContext },
    optional?: { reason?: string; signal?: AbortSignal }
  ): Promise<Outcome<RefundEvidence>>;
  /** Present iff `capabilities.capture === "manual"`. */
  capture?(
    required: { req: { providerRef: string; amount: Money; idempotencyKey: string }; ctx: ProviderContext },
    optional?: { signal?: AbortSignal }
  ): Promise<Outcome<PaymentEvidence>>;
  /** Present iff `capabilities.void`. */
  void?(
    required: { req: { providerRef: string; idempotencyKey: string }; ctx: ProviderContext },
    optional?: { signal?: AbortSignal }
  ): Promise<Outcome<PaymentEvidence>>;
  /** Present iff `capabilities.retrieve !== "none"`. Used for unknown outcomes, id-only webhooks and reconcile. */
  retrieve?(
    required: { providerRef: string; ctx: ProviderContext },
    optional?: { signal?: AbortSignal }
  ): Promise<Outcome<PaymentEvidence>>;
  /**
   * Verify the signature over the EXACT raw bytes and translate to facts. Secret rotation: a provider
   * declares an extra slot (e.g. `webhookSecretPrevious`) in `credentialKeys` and accepts either; one
   * slot holds one value. Never throws; a bad signature is `rejected` with SIGNATURE_INVALID.
   */
  verifyWebhook(
    required: { rawBody: Uint8Array; headers: Readonly<Record<string, string>>; ctx: ProviderContext },
    optional?: Record<string, never>
  ): Promise<Outcome<readonly WebhookFact[]>>;
}

/** Builds a `PaymentError`, omitting `providerStatus` when absent. */
export function paymentError(
  { code, message }: { code: PaymentErrorCode; message: string },
  optional: { retryable?: boolean; providerStatus?: number } = {}
): PaymentError {
  return {
    code,
    message,
    retryable: optional.retryable ?? false,
    ...(optional.providerStatus === undefined ? {} : { providerStatus: optional.providerStatus }),
  };
}

/** True when the provider accepts this currency. */
export function supportsCurrency(
  { capabilities, currency }: { capabilities: ProviderCapabilities; currency: string },
  _optional: Record<string, never> = {}
): boolean {
  return capabilities.currencies === "any" || capabilities.currencies.includes(currency);
}
