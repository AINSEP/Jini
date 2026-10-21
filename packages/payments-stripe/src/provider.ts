/**
 * @file The Stripe payment provider (commerce design 2026-10-21, lot L6a), on PaymentIntents.
 *
 * A stateless translator, as the kernel contract requires: it writes no rows and owns no
 * idempotency. The kernel's stable `idempotencyKey` goes to Stripe as `Idempotency-Key` on every
 * mutation, and OUR ids travel in `metadata[jini_payment_id]` / `metadata[jini_refund_id]`, so
 * Stripe echoes them on every object and webhook (`echoesCorrelation: true`).
 *
 * Replaces the deprecated `@jini-ai/capability-providers` Stripe port (legacy Charges API, full
 * refunds only, no idempotency, and an error mapping that could not tell "declined" from "timed out").
 */
import type {
  IntentRequest,
  Outcome,
  PaymentEvidence,
  PaymentProvider,
  ProviderContext,
  RefundEvidence,
  RefundRequest,
} from "@jini-ai/commerce/payments/kernel";
import { amountToStripe, currencyToStripe } from "./amounts.js";
import { localRejection, unparseableSuccess } from "./errors.js";
import { idOf, isRecord, optionalString, type JsonObject } from "./json.js";
import { disputeEvidence, intentEvidence, PAYMENT_ID_METADATA, readAll, REFUND_ID_METADATA, refundEvidence } from "./objects.js";
import { callStripe, type StripeCall, type StripeTransportConfig } from "./transport.js";
import { verifyStripeWebhook } from "./webhook.js";

export const STRIPE_PROVIDER_ID = "stripe";
export const STRIPE_API_BASE = "https://api.stripe.com";
/** Pinned so object shapes (`latest_charge`, refunds not embedded on the intent) cannot drift with the account default. */
export const STRIPE_API_VERSION = "2024-06-20";

export interface StripeProviderOptional {
  /** API origin; tests and Stripe-compatible mocks only. Trailing slashes are dropped. */
  readonly apiBase?: string;
  readonly apiVersion?: string;
  /** Webhook replay window in seconds (Stripe's libraries default to 300). */
  readonly toleranceSec?: number;
  /** Socket idle budget per request, ms. */
  readonly timeoutMs?: number;
  /** Most list pages `retrieve` follows for one intent's refunds or disputes (100 per page). */
  readonly maxListPages?: number;
}

type Ok<T> = Extract<Outcome<T>, { kind: "ok" }>;
type Call = (call: StripeCall, signal: AbortSignal | undefined) => Promise<Outcome<JsonObject>>;

const STRIPE_REFUND_REASONS: ReadonlySet<string> = new Set(["duplicate", "fraudulent", "requested_by_customer"]);
/** Stripe caps a metadata value at 500 characters. */
const METADATA_MAX = 500;

const withSignal = (signal: AbortSignal | undefined) => (signal === undefined ? {} : { signal });
const ok = <T>(value: T): Ok<T> => ({ kind: "ok", value });

/** Turn an `ok` JSON body into a typed value, or `unknown` when the 2xx body is not what we asked for. */
function mapOk<T>(outcome: Outcome<JsonObject>, read: (body: JsonObject) => T | undefined, what: string): Outcome<T> {
  if (outcome.kind !== "ok") return outcome;
  const value = read(outcome.value);
  return value === undefined ? unparseableSuccess({ status: 200, what }) : ok(value);
}

const readIntent = (body: JsonObject) => intentEvidence({ intent: body });

function intentForm(req: IntentRequest, ctx: ProviderContext): Array<readonly [string, string]> {
  const form: Array<readonly [string, string]> = [
    ["amount", String(amountToStripe({ money: req.amount }))],
    ["currency", currencyToStripe({ money: req.amount })],
    ["capture_method", req.captureMode === "manual" ? "manual" : "automatic"],
    [`metadata[${PAYMENT_ID_METADATA}]`, req.correlationId],
  ];
  // `providerOptions.paymentMethod` (a `pm_…` id) confirms server-side; without it Stripe.js confirms with the client secret.
  const paymentMethod = optionalString(req.providerOptions?.paymentMethod);
  if (paymentMethod === undefined) return form;
  form.push(["payment_method", paymentMethod], ["confirm", "true"]);
  if (ctx.returnUrl.length > 0) form.push(["return_url", ctx.returnUrl]);
  return form;
}

function refundForm(req: RefundRequest, reason: string | undefined): Array<readonly [string, string]> {
  const form: Array<readonly [string, string]> = [
    ["payment_intent", req.providerRef],
    ["amount", String(amountToStripe({ money: req.amount }))],
    [`metadata[${REFUND_ID_METADATA}]`, req.correlationId],
  ];
  if (reason === undefined) return form;
  // Stripe's `reason` is a closed enum; any other text is kept as metadata so it is not lost.
  form.push(STRIPE_REFUND_REASONS.has(reason) ? ["reason", reason] : ["metadata[jini_refund_reason]", reason.slice(0, METADATA_MAX)]);
  return form;
}

/** Linear on purpose: a `/\/+$/` regex backtracks on long slash runs. */
function trimTrailingSlashes(base: string): string {
  let end = base.length;
  while (end > 0 && base[end - 1] === "/") end -= 1;
  return base.slice(0, end);
}

const intentPath = (ref: string, action = "") => `/v1/payment_intents/${encodeURIComponent(ref)}${action}`;

/**
 * Follow a Stripe list (`{ data, has_more }`) page by page. Any unreadable page or element makes
 * the whole read `unknown`; running past `maxPages` does too, rather than returning a partial list.
 */
async function listAll<T>(
  { call, path, filter, read, maxPages, signal }: {
    call: Call; path: string; filter: readonly [string, string]; read: (item: JsonObject) => T | undefined; maxPages: number; signal: AbortSignal | undefined;
  }
): Promise<Outcome<T[]>> {
  const items: T[] = [];
  let after: string | undefined;
  for (let page = 0; page < maxPages; page += 1) {
    const query: Array<readonly [string, string]> = [filter, ["limit", "100"], ...(after === undefined ? [] : [["starting_after", after] as const])];
    const outcome = mapOk(await call({ method: "GET", path, query }, signal), (body) => readPage(body, read), "list");
    if (outcome.kind !== "ok") return outcome;
    items.push(...outcome.value.items);
    if (!outcome.value.hasMore) return ok(items);
    after = outcome.value.lastId;
  }
  return unparseableSuccess({ status: 200, what: `list within ${maxPages} pages` });
}

function readPage<T>(body: JsonObject, read: (item: JsonObject) => T | undefined): { items: T[]; hasMore: boolean; lastId: string | undefined } | undefined {
  if (!Array.isArray(body.data) || typeof body.has_more !== "boolean") return undefined;
  const items = readAll({ items: body.data, read });
  const last: unknown = body.data.at(-1);
  const lastId = isRecord(last) ? optionalString(last.id) : undefined;
  // A `has_more` page must name its last element, or the next page cannot be asked for.
  if (items === undefined || (body.has_more && lastId === undefined)) return undefined;
  return { items, hasMore: body.has_more, lastId };
}

/**
 * Create the Stripe provider.
 * @param _required - Nothing: credentials arrive per call in `ctx.credentials` (`secretKey`,
 *   `webhookSecret`, optional `webhookSecretPrevious` for rotation).
 * @param optional - API base/version, webhook tolerance (default 300 s), request timeout, list page cap.
 * @returns A `PaymentProvider` with id `stripe`; register it through the plugin loader.
 * @complexity O(1) per call, plus list pages in `retrieve`.
 */
export function createStripeProvider(_required: Record<string, never> = {}, optional: StripeProviderOptional = {}): PaymentProvider {
  const config: StripeTransportConfig = {
    apiBase: trimTrailingSlashes(optional.apiBase ?? STRIPE_API_BASE),
    apiVersion: optional.apiVersion ?? STRIPE_API_VERSION,
    timeoutMs: optional.timeoutMs ?? 30_000,
  };
  const toleranceSec = optional.toleranceSec ?? 300;
  const maxPages = optional.maxListPages ?? 10;
  const caller = (ctx: ProviderContext): Call => (call, signal) => callStripe({ call, ctx, config }, withSignal(signal));

  const retrieveDisputes = async (call: Call, intent: JsonObject, signal: AbortSignal | undefined): Promise<Outcome<PaymentEvidence["disputes"]>> => {
    const charge = idOf(intent.latest_charge);
    if (charge === undefined) return ok([]);
    return listAll({ call, path: "/v1/disputes", filter: ["charge", charge], read: (dispute) => disputeEvidence({ dispute }), maxPages, signal });
  };

  return {
    id: STRIPE_PROVIDER_ID,
    displayName: "Stripe",
    capabilities: {
      refunds: "partial",
      capture: "manual",
      void: true,
      disputes: true,
      retrieve: "payment+refunds",
      echoesCorrelation: true,
      confirmation: ["none", "redirect", "client_action"],
      currencies: "any",
    },
    credentialKeys: ["secretKey", "webhookSecret", "webhookSecretPrevious"],

    async createIntent({ req, ctx }, { signal } = {}) {
      const call: StripeCall = { method: "POST", path: "/v1/payment_intents", form: intentForm(req, ctx), idempotencyKey: req.idempotencyKey };
      const outcome = mapOk(await caller(ctx)(call, signal), readIntent, "PaymentIntent");
      return outcome.kind === "ok" ? ok({ evidence: outcome.value, next: outcome.value.next }) : outcome;
    },

    async refund({ req, ctx }, { reason, signal } = {}): Promise<Outcome<RefundEvidence>> {
      const call: StripeCall = { method: "POST", path: "/v1/refunds", form: refundForm(req, reason), idempotencyKey: req.idempotencyKey };
      return mapOk(await caller(ctx)(call, signal), (refund) => refundEvidence({ refund }), "Refund");
    },

    async capture({ req, ctx }, { signal } = {}) {
      const form = [["amount_to_capture", String(amountToStripe({ money: req.amount }))] as const];
      const call: StripeCall = { method: "POST", path: intentPath(req.providerRef, "/capture"), form, idempotencyKey: req.idempotencyKey };
      return mapOk(await caller(ctx)(call, signal), readIntent, "PaymentIntent");
    },

    async void({ req, ctx }, { signal } = {}) {
      const call: StripeCall = { method: "POST", path: intentPath(req.providerRef, "/cancel"), idempotencyKey: req.idempotencyKey };
      return mapOk(await caller(ctx)(call, signal), readIntent, "PaymentIntent");
    },

    async retrieve({ providerRef, ctx }, { signal } = {}) {
      if (providerRef.length === 0) return localRejection({ code: "INVALID_REQUEST", message: "providerRef is empty" });
      const call = caller(ctx);
      const raw = await call({ method: "GET", path: intentPath(providerRef) }, signal);
      if (raw.kind !== "ok") return raw;
      const intent = readIntent(raw.value);
      if (intent === undefined) return unparseableSuccess({ status: 200, what: "PaymentIntent" });
      const refunds = await listAll({ call, path: "/v1/refunds", filter: ["payment_intent", providerRef], read: (refund) => refundEvidence({ refund }), maxPages, signal });
      if (refunds.kind !== "ok") return refunds;
      const disputes = await retrieveDisputes(call, raw.value, signal);
      if (disputes.kind !== "ok") return disputes;
      return ok({ ...intent, refunds: refunds.value, disputes: disputes.value });
    },

    verifyWebhook({ rawBody, headers, ctx }) {
      return verifyStripeWebhook({ rawBody, headers, ctx, toleranceSec });
    },
  };
}
