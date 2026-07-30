/**
 * `@jini-ai/capability-providers/adapters/stripe` — the one real,
 * production-quality `PaymentsProvider` adapter this package ships, against
 * Stripe's real, documented Charges/Refunds REST API
 * (`https://docs.stripe.com/api/charges`, `https://docs.stripe.com/api/refunds`)
 * — verified against Stripe's own docs while building this, not guessed from
 * memory (request shape, Basic auth over the secret key, form-encoded body,
 * JSON error envelope).
 *
 * Lives at this separate entry point (not the package's main
 * `@jini-ai/capability-providers` barrel) so importing the port
 * interface/types/DI tokens never pulls a vendor-specific HTTP client into a
 * consumer that only wanted the `PaymentsProvider` interface to implement
 * itself against a different processor. Import from here only when you actually
 * want this concrete adapter.
 *
 * The in-memory reference implementation (`createInMemoryPaymentsProvider`) is
 * a separate, non-production stub under `src/unsafe-reference/` — see that
 * directory's `index.ts` header for the full warning.
 */
import type { Charge, ChargeInput, ChargeStatus, PaymentsProvider } from '../../payments.js';

const STRIPE_API_BASE = 'https://api.stripe.com/v1';

/** Error thrown by {@link StripePaymentsProvider}, carrying Stripe's own error envelope fields (`https://docs.stripe.com/api/errors`) when the failure came from a Stripe API response. */
export class StripePaymentsProviderError extends Error {
  /** The HTTP status Stripe (or a local pre-flight check) returned. */
  readonly status: number;
  /** Stripe's `error.type` — one of `api_error`, `card_error`, `idempotency_error`, `invalid_request_error`. Undefined for a local pre-flight rejection (e.g. a non-positive amount) that never reached Stripe. */
  readonly stripeType?: string;
  /** Stripe's `error.code`, when present. */
  readonly stripeCode?: string;

  constructor(message: string, status: number, stripeType?: string, stripeCode?: string) {
    super(message);
    this.name = 'StripePaymentsProviderError';
    this.status = status;
    if (stripeType !== undefined) this.stripeType = stripeType;
    if (stripeCode !== undefined) this.stripeCode = stripeCode;
  }
}

export interface StripePaymentsProviderOptions {
  /** Stripe secret key (`sk_live_...`/`sk_test_...`). Required and explicit — never read from an environment variable inside this adapter. */
  readonly secretKey: string;
  /** Pluggable fetch for tests. Defaults to `globalThis.fetch`, matching `S3BlobStorage`/`netlify.ts`'s precedent in this repo. */
  readonly fetchFn?: typeof fetch;
  /** Overrides Stripe's API base URL. Tests only — production leaves this unset. */
  readonly apiBase?: string;
}

/**
 * Maps a raw Stripe Charge JSON object's `status` (`'succeeded' | 'pending' | 'failed'` per
 * Stripe's documented Charge object) plus its separate `refunded` boolean onto this port's
 * `ChargeStatus`. `refunded: true` always wins — Stripe leaves `status` at `'succeeded'` even
 * after a full refund, but this port's `ChargeStatus` models "refunded" as its own terminal
 * state distinct from "succeeded", so a charge this adapter itself refunded (or that was
 * refunded directly in Stripe) reports as `'refunded'` here.
 */
function mapStripeChargeStatus(raw: unknown, refunded: unknown): ChargeStatus {
  if (refunded === true) return 'refunded';
  if (raw === 'succeeded' || raw === 'pending' || raw === 'failed') return raw;
  // Stripe's Charge.status is documented as exactly succeeded | pending | failed — this branch
  // has no real reachable path against Stripe's actual contract, but keeps the mapping total
  // against `unknown` JSON (an arbitrary HTTP response body) rather than asserting.
  return 'pending';
}

/**
 * `PaymentsProvider` adapter against Stripe's real Charges/Refunds REST API. No mock/simulated
 * money movement — every `charge`/`getCharge`/`refund` call is a real HTTP request to
 * `api.stripe.com` (or `options.apiBase` in tests), authenticated the way Stripe's own docs
 * specify: HTTP Basic auth with the secret key as the username and an empty password
 * (`Authorization: Basic base64("sk_...:")`), request bodies form-encoded
 * (`application/x-www-form-urlencoded`), not JSON.
 *
 * `ChargeInput.customerRef` is sent as Stripe's `customer` parameter — this adapter always
 * charges an existing Stripe Customer (who must already have a default/attached payment method),
 * never a one-off `source`/token; `ChargeInput` has no field for a raw card token, and inventing
 * one wasn't part of this port's brief.
 */
export class StripePaymentsProvider implements PaymentsProvider {
  private readonly fetchFn: typeof fetch;
  private readonly apiBase: string;

  constructor(private readonly options: StripePaymentsProviderOptions) {
    if (!options.secretKey) {
      throw new StripePaymentsProviderError('StripePaymentsProvider requires a non-empty options.secretKey', 401);
    }
    const fn = options.fetchFn ?? globalThis.fetch;
    if (!fn) {
      throw new StripePaymentsProviderError('StripePaymentsProvider requires a fetch implementation', 500);
    }
    this.fetchFn = fn;
    this.apiBase = (options.apiBase ?? STRIPE_API_BASE).replace(/\/+$/, '');
  }

  async charge(input: ChargeInput): Promise<Charge> {
    if (input.amountCents <= 0) {
      throw new StripePaymentsProviderError('amountCents must be positive', 400);
    }
    const body = new URLSearchParams({
      amount: String(input.amountCents),
      currency: input.currency,
      customer: input.customerRef,
    });
    if (input.description !== undefined) body.set('description', input.description);
    const json = await this.request('POST', '/charges', body);
    return this.toCharge(json);
  }

  async getCharge(id: string): Promise<Charge | null> {
    try {
      const json = await this.request('GET', `/charges/${encodeURIComponent(id)}`);
      return this.toCharge(json);
    } catch (err) {
      if (err instanceof StripePaymentsProviderError && err.status === 404) return null;
      throw err;
    }
  }

  /**
   * `PaymentsProvider.refund` returns a completed `Charge`, but a real Stripe `Refund` object's
   * own `status` can be `'succeeded'`, `'pending'` (common for bank-sourced refunds that settle
   * over days), `'failed'`, or `'canceled'` — a richer state machine than this port's
   * `ChargeStatus` has room for. Since `ChargeStatus` has no "refund in flight" state, `'pending'`
   * is treated the same as `'succeeded'` here (Stripe accepted the refund; it will settle) and
   * only `'failed'`/`'canceled'` reject. A host that needs to distinguish "refund accepted" from
   * "refund settled" should track Stripe's own refund object separately — out of scope for this
   * port's `Charge`-shaped return value.
   */
  async refund(id: string): Promise<Charge> {
    const existing = await this.getCharge(id);
    if (!existing) {
      throw new StripePaymentsProviderError(`unknown charge: ${id}`, 404);
    }
    if (existing.status !== 'succeeded') {
      throw new StripePaymentsProviderError(`charge ${id} is not refundable from status "${existing.status}"`, 400);
    }
    const json = await this.request('POST', '/refunds', new URLSearchParams({ charge: id }));
    const refundStatus = json.status;
    if (refundStatus === 'failed' || refundStatus === 'canceled') {
      throw new StripePaymentsProviderError(
        `Stripe refund ${String(refundStatus)} for charge ${id}`,
        402,
        'api_error',
      );
    }
    return { ...existing, status: 'refunded' };
  }

  private authHeader(): string {
    return `Basic ${Buffer.from(`${this.options.secretKey}:`).toString('base64')}`;
  }

  private async request(method: 'GET' | 'POST', path: string, formBody?: URLSearchParams): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = { Authorization: this.authHeader() };
    const init: RequestInit = { method, headers };
    if (formBody) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      init.body = formBody.toString();
    }
    const res = await this.fetchFn(`${this.apiBase}${path}`, init);
    const json = await this.safeJson(res);
    if (!res.ok) throw this.toError(res.status, json);
    return json;
  }

  private async safeJson(res: Response): Promise<Record<string, unknown>> {
    try {
      const parsed: unknown = await res.json();
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  private toError(status: number, json: Record<string, unknown>): StripePaymentsProviderError {
    const errorObj = json.error && typeof json.error === 'object' ? (json.error as Record<string, unknown>) : {};
    const message = typeof errorObj.message === 'string' && errorObj.message ? errorObj.message : `Stripe request failed (${status}).`;
    const stripeType = typeof errorObj.type === 'string' ? errorObj.type : undefined;
    const stripeCode = typeof errorObj.code === 'string' ? errorObj.code : undefined;
    return new StripePaymentsProviderError(message, status, stripeType, stripeCode);
  }

  private toCharge(json: Record<string, unknown>): Charge {
    return {
      id: typeof json.id === 'string' ? json.id : '',
      status: mapStripeChargeStatus(json.status, json.refunded),
      amountCents: typeof json.amount === 'number' ? json.amount : 0,
      currency: typeof json.currency === 'string' ? json.currency : '',
      customerRef: typeof json.customer === 'string' ? json.customer : '',
      // Stripe's `created` is Unix seconds; this port's `createdAt` is epoch milliseconds.
      createdAt: typeof json.created === 'number' ? json.created * 1000 : Date.now(),
    };
  }
}
