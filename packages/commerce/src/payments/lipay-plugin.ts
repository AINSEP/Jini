/**
 * @file lipay — the payments framework plugin (architecture review §3/§4/§6).
 *
 * Role: what WooCommerce is, not what one gateway is. lipay owns the tables, the public API, the
 * idempotency machinery and the webhook normalization; concrete gateways — including the
 * first-party `lipay` gateway in `providers/lipay-gateway.ts` — are `PaymentProvider`
 * implementations registered into it. The design property this file exists to make true:
 *
 *   Adding a payment provider requires exactly ONE new file and ONE registration line, with zero
 *   edits to lipay's tables, public API, error union, or webhook route.
 *
 * Kept verbatim from `deploy-plugin.ts` (the established Tier-2 template): typed result/error
 * unions that never throw out of the public API; the guarded `HttpClientPort` seam, never a raw
 * `fetch`; the rule-of-two credential shape; and `declareDataModule()` on the storage kernel it is
 * handed, every statement through `kernel.run` so one body serves SQLite and Postgres.
 *
 * Deviating from it on three points, deliberately. (1) An open registry replaces the closed
 * `DeployTarget` union and its `if (target === "vercel")` dispatch — a closed union makes every
 * provider a core edit. (2) A per-provider credential BUNDLE replaces `getToken(target)`, since one
 * opaque string cannot carry `{secretKey, webhookSecret, merchantId, passkey}`. (3) Payments need a
 * lifecycle deploy does not model at all: deploy is fire-and-forget with a two-state history row
 * and never learns the eventual build outcome, whereas for payments the AUTHORITATIVE answer
 * arrives asynchronously and may contradict the synchronous one. Hence `pending`, the inbound event
 * log, and idempotency on both directions — deploy triggering twice wastes a build; charging twice
 * takes someone's money twice.
 *
 * Observability: this repo has no logger/telemetry port for feature code to depend on (verified —
 * neither `store-plugin.ts` nor `deploy-plugin.ts` has one either). `p_lipay__events` and
 * `p_lipay__payments`/`p_lipay__refunds` ARE the durable record: every inbound provider
 * notification is persisted verbatim with its verification outcome, and every outbound attempt is a
 * row. Wiring a real telemetry seam is left for when one exists.
 */
import type { Kysely } from "kysely";

import type { HttpClientPort } from "@jini-ai/core/primitives";
import type { StorageKernel } from "@jini-ai/db/kernel";
import { createPaymentProviderRegistry } from "./registry.js";
import { canTransition, isTerminalPaymentStatus, statusForEventKind, type PaymentStatus } from "./state-machine.js";
import type {
  ChargeNextAction,
  Money,
  NormalizedPaymentEvent,
  PaymentCredentialsPort,
  PaymentError,
  PaymentProvider,
  PaymentProviderCapabilities,
  PaymentProviderId,
  ProviderChargeInput,
  ProviderContext,
} from "./ports.js";

export const LIPAY_PLUGIN_ID = "lipay";

const PAYMENTS = `p_${LIPAY_PLUGIN_ID}__payments` as const;
const EVENTS = `p_${LIPAY_PLUGIN_ID}__events` as const;
const REFUNDS = `p_${LIPAY_PLUGIN_ID}__refunds` as const;

/** The public path the core-owned webhook route is mounted on. One route, every provider. */

export const webhookUrlFor = ({ baseUrl, providerId }: { baseUrl: string; providerId: PaymentProviderId }, _optional: Record<string, never> = {}): string =>
  `${baseUrl.replace(/\/+$/, "")}/payments/webhook/${providerId}`;

/**
 * Three tables, namespaced by core as `p_lipay__*`. Single-word short names deliberately: ADR-023's
 * `data-module.ts` grammar permits underscores and forbids hyphens, while ADR-026 mandates
 * `^[a-z0-9]+(-[a-z0-9]+)*$` with no underscore anywhere. The two are mutually exclusive except on
 * their intersection — single-segment names with no separator — which is free for a greenfield
 * plugin and is the only shape that satisfies both (review R2).
 *
 * Deliberately absent: no `providers` table (providers are code plus environment credentials, never
 * rows — a provider must not be enablable by a database write, the direct inverse of WooCommerce's
 * `woocommerce_{id}_settings` option row); no card data, PAN or tokens; and no `orders` table,
 * because lipay is a payments plugin, not a commerce plugin.
 */

export interface PaymentRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly providerId: PaymentProviderId;
  readonly idempotencyKey: string;
  readonly status: PaymentStatus;
  readonly amount: Money;
  readonly amountRefundedMinor: number;
  readonly providerRef: string | null;
  readonly reference: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly lastError: string | null;
}

export type RefundStatus = "pending" | "succeeded" | "failed";

export interface RefundRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly paymentId: string;
  readonly idempotencyKey: string;
  readonly providerRef: string | null;
  readonly amount: Money;
  readonly status: RefundStatus;
  readonly reason: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** What a checkout picker or admin screen renders from — never a hardcoded provider list. */
export interface PaymentProviderSummary {
  readonly id: PaymentProviderId;
  readonly displayName: string;
  readonly capabilities: PaymentProviderCapabilities;
}

export interface ChargeRequest {
  readonly workspaceId: string;
  readonly providerId: PaymentProviderId;
  readonly amount: Money;
  /** Caller-supplied. Replaying the same key returns the ORIGINAL result, never a second charge. */
  readonly idempotencyKey: string;
  readonly reference?: (string) | undefined;
  readonly customer?: ({ readonly email?: (string) | undefined; readonly name?: (string) | undefined }) | undefined;
  readonly providerOptions?: (Readonly<Record<string, unknown>>) | undefined;
}

export type ChargeResult =
  | {
      readonly ok: true;
      readonly payment: PaymentRecord;
      /**
       * What the shopper must do next — `null` on an idempotent replay. The next-action is
       * transport state, not payment state, and §3's schema has no column for it, so a replayed
       * request can return the authoritative payment record but not reconstruct the original
       * redirect URL or SDK payload. Disclosed rather than silently papered over; a caller that
       * needs replay-safe resumption must persist the first response itself.
       */
      readonly next: ChargeNextAction | null;
      /** True when the idempotency key matched an existing payment and no provider call was made. */
      readonly replayed: boolean;
    }
  | { readonly ok: false; readonly error: PaymentError; readonly payment: PaymentRecord | null };

export interface RefundRequest {
  readonly workspaceId: string;
  readonly paymentId: string;
  readonly idempotencyKey: string;
  /** Omitted = refund the full remaining amount. */
  readonly amount?: (Money) | undefined;
  readonly reason?: (string) | undefined;
}

export type RefundResult =
  | { readonly ok: true; readonly refund: RefundRecord; readonly payment: PaymentRecord; readonly replayed: boolean }
  | { readonly ok: false; readonly error: PaymentError };

/** 2xx-fast: log-and-accept beats an infinite provider retry storm. */
export interface WebhookAck {
  readonly accepted: boolean;
  readonly processed: number;
  readonly duplicates: number;
  readonly error?: (PaymentError) | undefined;
}

export interface LipayApi {
  listProviders(required?: Record<string, never>, optional?: Record<string, never>): readonly PaymentProviderSummary[];
  charge(input: ChargeRequest, optional?: Record<string, never>): Promise<ChargeResult>;
  refund(input: RefundRequest, optional?: Record<string, never>): Promise<RefundResult>;
  /** Called by the one core-owned webhook route. Provider-agnostic. */
  handleWebhook(input: {
    readonly providerId: PaymentProviderId;
    readonly rawBody: Buffer;
    readonly headers: Readonly<Record<string, string>>;
  }, optional?: Record<string, never>): Promise<WebhookAck>;
  getPayment(required: { workspaceId: string; id: string }, optional?: Record<string, never>): Promise<PaymentRecord | null>;
  listPayments(required: { workspaceId: string }, optional?: { limit?: (number) | undefined }): Promise<readonly PaymentRecord[]>;
}

type PaymentRow = {
  id: string;
  workspace_id: string;
  provider_id: string;
  idempotency_key: string;
  status: string;
  amount_minor: number;
  currency: string;
  amount_refunded_minor: number;
  provider_ref: string | null;
  reference: string | null;
  created_at: number;
  updated_at: number;
  last_error: string | null;
};

type RefundRow = {
  id: string;
  workspace_id: string;
  payment_id: string;
  idempotency_key: string;
  provider_ref: string | null;
  amount_minor: number;
  currency: string;
  status: string;
  reason: string | null;
  created_at: number;
  updated_at: number;
};

type EventRow = {
  id: string;
  workspace_id: string;
  provider_id: string;
  provider_event_id: string;
  payment_id: string | null;
  kind: string;
  occurred_at: number;
  received_at: number;
  /** 0/1 — the declared type set has no BOOLEAN. */
  applied: number;
  payload: string;
};

/** lipay's three tables, as Kysely sees them. Type aliases: `withTables` needs their index signature. */
type LipayTables = {
  [PAYMENTS]: PaymentRow;
  [EVENTS]: EventRow;
  [REFUNDS]: RefundRow;
};

const toPaymentRecord = (row: PaymentRow): PaymentRecord => ({
  id: row.id,
  workspaceId: row.workspace_id,
  providerId: row.provider_id,
  idempotencyKey: row.idempotency_key,
  status: row.status as PaymentStatus,
  amount: { minorUnits: row.amount_minor, currency: row.currency },
  amountRefundedMinor: row.amount_refunded_minor,
  providerRef: row.provider_ref,
  reference: row.reference,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  lastError: row.last_error,
});

const toRefundRecord = (row: RefundRow): RefundRecord => ({
  id: row.id,
  workspaceId: row.workspace_id,
  paymentId: row.payment_id,
  idempotencyKey: row.idempotency_key,
  providerRef: row.provider_ref,
  amount: { minorUnits: row.amount_minor, currency: row.currency },
  status: row.status as RefundStatus,
  reason: row.reason,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const error = (
  code: PaymentError["code"],
  message: string,
  optional: { retryable?: (boolean) | undefined; providerStatus?: (number) | undefined } = {}
): PaymentError => ({
  code,
  message,
  retryable: optional.retryable ?? false,
  ...(optional.providerStatus === undefined ? {} : { providerStatus: optional.providerStatus }),
});

const CURRENCY = /^[A-Z]{3}$/;

/** Structural money validation. Currency-specific minor-unit scale is out of scope (review R7). */
function invalidAmount(amount: Money): string | null {
  if (!CURRENCY.test(amount.currency)) return `currency must be an uppercase ISO-4217 alpha-3 code, got '${amount.currency}'`;
  if (!Number.isSafeInteger(amount.minorUnits)) return "amount.minorUnits must be a safe integer number of minor units";
  if (amount.minorUnits <= 0) return "amount.minorUnits must be greater than zero";
  return null;
}

function supportsCurrency(capabilities: PaymentProviderCapabilities, currency: string): boolean {
  return capabilities.currencies === "any" || capabilities.currencies.includes(currency);
}

/** The three request-shape checks `charge()` needs before it may touch the database at all. */
function validateChargeInput(provider: PaymentProvider, input: ChargeRequest): PaymentError | null {
  if (input.idempotencyKey.trim().length === 0) {
    return error("INVALID_REQUEST", "idempotencyKey must be a non-empty string");
  }
  const amountProblem = invalidAmount(input.amount);
  if (amountProblem) return error("INVALID_REQUEST", amountProblem);
  if (!supportsCurrency(provider.capabilities, input.amount.currency)) {
    return error("CURRENCY_UNSUPPORTED", `provider '${provider.id}' does not accept ${input.amount.currency}`);
  }
  return null;
}

/** Outbound idempotency: `undefined` when no row exists yet, otherwise the final `ChargeResult`
 * for the replay (a mismatched request is a conflict, a matching one is the original payment). */
function resolveExistingCharge(existing: PaymentRow | undefined, input: ChargeRequest): ChargeResult | undefined {
  if (!existing) return undefined;
  const sameRequest =
    existing.provider_id === input.providerId &&
    existing.amount_minor === input.amount.minorUnits &&
    existing.currency === input.amount.currency;
  if (!sameRequest) {
    return {
      ok: false,
      payment: toPaymentRecord(existing),
      error: error(
        "IDEMPOTENCY_CONFLICT",
        `idempotency key '${input.idempotencyKey}' was already used for a different provider/amount/currency`
      ),
    };
  }
  return { ok: true, payment: toPaymentRecord(existing), next: null, replayed: true };
}

/** Shapes the outbound `ProviderChargeInput`, dropping the optional fields the caller omitted
 * rather than forwarding them as `undefined`. */
function buildChargeProviderRequest(input: ChargeRequest): ProviderChargeInput {
  return {
    amount: input.amount,
    // The caller's key, forwarded verbatim to providers that support it (Stripe's
    // `Idempotency-Key` header), so a retry is deduplicated on BOTH sides of the seam.
    idempotencyKey: input.idempotencyKey,
    ...(input.reference === undefined ? {} : { reference: input.reference }),
    ...(input.customer === undefined ? {} : { customer: input.customer }),
    ...(input.providerOptions === undefined ? {} : { providerOptions: input.providerOptions }),
  };
}

/** A refund is only legal from a payment that has settled money to refund in the first place. */
function validateRefundStatus(payment: PaymentRecord): PaymentError | null {
  if (payment.status !== "succeeded" && payment.status !== "partially_refunded") {
    return error("INVALID_REQUEST", `a payment in status '${payment.status}' cannot be refunded`);
  }
  return null;
}

/**
 * Resolves the refund amount (defaulting to "everything still remaining") and every money
 * invariant it must satisfy: well-formed, same currency as the payment, not more than what
 * remains, and — for a "full refunds only" provider — not a partial amount at all.
 */
function resolveRefundAmount(
  input: RefundRequest,
  payment: PaymentRecord,
  provider: PaymentProvider
): { ok: true; amount: Money } | { ok: false; error: PaymentError } {
  const remaining = payment.amount.minorUnits - payment.amountRefundedMinor;
  const amount = input.amount ?? { minorUnits: remaining, currency: payment.amount.currency };

  const amountProblem = invalidAmount(amount);
  if (amountProblem) return { ok: false, error: error("INVALID_REQUEST", amountProblem) };
  if (amount.currency !== payment.amount.currency) {
    return {
      ok: false,
      error: error(
        "CURRENCY_UNSUPPORTED",
        `refund currency ${amount.currency} does not match the payment's ${payment.amount.currency}`
      ),
    };
  }
  // The aggregate invariant `amount_refunded_minor <= amount_minor`, which the schema itself
  // cannot express (no CHECK constraint in the declared grammar).
  if (amount.minorUnits > remaining) {
    return {
      ok: false,
      error: error(
        "INVALID_REQUEST",
        `refund of ${amount.minorUnits} exceeds the ${remaining} still refundable on payment ${payment.id}`
      ),
    };
  }
  if (provider.capabilities.refunds === "full" && amount.minorUnits !== payment.amount.minorUnits) {
    return { ok: false, error: error("CAPABILITY_UNSUPPORTED", `provider '${provider.id}' supports full refunds only`) };
  }
  return { ok: true, amount };
}

/** Inbound refund idempotency — same shape as `resolveExistingCharge`, one layer down. */
function resolveExistingRefund(
  existing: RefundRow | undefined,
  input: RefundRequest,
  amount: Money,
  payment: PaymentRecord
): RefundResult | undefined {
  if (!existing) return undefined;
  const sameRequest =
    existing.payment_id === input.paymentId && existing.amount_minor === amount.minorUnits && existing.currency === amount.currency;
  if (!sameRequest) {
    return {
      ok: false,
      error: error("IDEMPOTENCY_CONFLICT", `idempotency key '${input.idempotencyKey}' was already used for a different refund`),
    };
  }
  return { ok: true, refund: toRefundRecord(existing), payment, replayed: true };
}

/** How much of `event`'s refund applies — the event's own amount when it carries one, otherwise
 * "the whole charge" (a provider that reports refunds without a partial amount). */
function incomingRefundAmount(event: NormalizedPaymentEvent, paymentRow: PaymentRow): number {
  return event.amount?.minorUnits ?? paymentRow.amount_minor;
}

/**
 * The status half of an inbound event's decision, kept separate from its monetary half — the same
 * split `executeRefundAttempt` already makes on the direct `refund()` path.
 *
 * `"unchanged"` is what makes the split necessary: the event names the status the payment already
 * holds (a second partial refund that still does not complete the charge), so `canTransition`
 * correctly refuses the step even though the money behind the event did move. Collapsing that into
 * the `null` case is what let a webhook-reported partial refund vanish from the ledger.
 *
 * `null` is a genuine refusal: the event kind carries no status claim at all, or it names a status
 * the machine forbids from here (a refund reported against a still-`pending` charge).
 *
 * @complexity O(1) — the state machine's own fixed-size lookup, nothing else.
 */
function nextStatusForEvent(
  current: PaymentStatus,
  kind: NormalizedPaymentEvent["kind"],
  refund: { readonly refundedMinor: number; readonly totalMinor: number }
): PaymentStatus | "unchanged" | null {
  const next = statusForEventKind({ kind: kind, refund: refund });
  if (next === null) return null;
  if (next === current) return "unchanged";
  return canTransition({ from: current, to: next }) ? next : null;
}

/**
 * Pure decision: given an already-persisted event, should it actually move the payment, and how?
 *
 * `apply: false` covers every reason it should not (stale ordering, a terminal payment, a
 * transition the state machine rejects, or an event that names the current status without moving
 * any money) — `applyEvent()` treats them identically (`"recorded"`), so this collapses them into
 * one result shape instead of one branch each.
 *
 * `next: null` on an applied transition means "write the refunded total, leave the status alone".
 * That is the same-status partial refund, and it mirrors `executeRefundAttempt`'s `else` arm
 * exactly: the two write paths must agree on the ledger even where they disagree on the status.
 * A non-refund event can never reach it — `refundedTotal` is copied straight from the row for
 * every other kind, so the "did the money move?" test fails and the event stays merely recorded.
 *
 * @complexity O(1) — arithmetic and fixed-size state-machine lookups; no iteration.
 */
function computeEventTransition(
  paymentRow: PaymentRow,
  event: NormalizedPaymentEvent,
  lastAppliedAt: number | null
): { apply: false } | { apply: true; next: PaymentStatus | null; refundedTotal: number } {
  if (lastAppliedAt !== null && event.occurredAt < lastAppliedAt) return { apply: false };
  if (event.kind === "refunded" && event.amount !== undefined && event.amount.currency !== paymentRow.currency) {
    return { apply: false };
  }

  const current = paymentRow.status as PaymentStatus;
  if (isTerminalPaymentStatus({ status: current })) return { apply: false };

  const refundedTotal =
    event.kind === "refunded"
      ? Math.min(paymentRow.amount_refunded_minor + incomingRefundAmount(event, paymentRow), paymentRow.amount_minor)
      : paymentRow.amount_refunded_minor;

  const next = nextStatusForEvent(current, event.kind, {
    refundedMinor: refundedTotal,
    totalMinor: paymentRow.amount_minor,
  });
  if (next === null) return { apply: false };
  if (next !== "unchanged") return { apply: true, next, refundedTotal };
  return moneyOnlyTransition(paymentRow, refundedTotal);
}

/**
 * The same-status outcome: apply the event for its money alone when the refunded total actually
 * advanced, and refuse it otherwise so an event that changes nothing is never marked applied
 * (which would also drag the out-of-order watermark forward for free).
 *
 * @complexity O(1).
 */
function moneyOnlyTransition(
  paymentRow: PaymentRow,
  refundedTotal: number
): { apply: false } | { apply: true; next: null; refundedTotal: number } {
  if (refundedTotal === paymentRow.amount_refunded_minor) return { apply: false };
  return { apply: true, next: null, refundedTotal };
}

/**
 * Declare lipay's tables through core (snapshot → DDL) and return the payments API.
 *
 * Structurally identical to `activateDeploy`, with `providers` injected as a list rather than
 * compiled into a switch, and `clock`/`idGen` injected rather than `Date.now()`/`Math.random()`
 * inline as both existing plugin spikes do — for money, ordering and idempotency keys, ambient
 * nondeterminism is worse than it is for deploys.
 *
 * `webhookBaseUrl` and `returnUrl` are required beyond the review's §4.6 parameter list because
 * §4.3's `ProviderContext` mandates both and neither can be derived inside the plugin: the
 * externally reachable origin is a deployment fact.
 *
 * `db` is the site's storage kernel (or a SQLite connection, bridged to its kernel); `dbPath` names
 * the SQLite file behind it, for the declaration's snapshot.
 *
 * Idempotency is a UNIQUE index, never a status guard a provider author has to remember: every
 * keyed INSERT is `ON CONFLICT (<the unique columns>) DO NOTHING`, and zero inserted rows means a
 * replay. (Not a caught constraint error: on Postgres a failed statement aborts its transaction.)
 * Every read-then-write of a payment row runs in a transaction holding `lockKey` on that payment.
 */
export async function activateLipay(
  required: {
    kernel: StorageKernel<unknown>;
    prepareStorage: () => Promise<void>;
    workspaceId: string;
    httpClient: HttpClientPort;
    credentials: PaymentCredentialsPort;
    providers: readonly PaymentProvider[];
    clock: { now(): number };
    idGen: { newId(): string };
    webhookBaseUrl: string;
    returnUrl: string;
  },
  _optional: Record<string, never> = {}
): Promise<LipayApi> {
  const { workspaceId, httpClient, credentials, providers, clock, idGen, webhookBaseUrl, returnUrl } = required;
  const kernel = required.kernel;
  // The host owns schema safety and provenance. No commerce runtime is constructed until its
  // preparation port succeeds; importing this package never declares or reconciles tables.
  await required.prepareStorage();

  const registry = createPaymentProviderRegistry({ providers: providers });

  const contextFor = (provider: PaymentProvider, resolved: Readonly<Record<string, string>>): ProviderContext => ({
    credentials: resolved,
    httpClient,
    now: () => clock.now(),
    webhookUrl: webhookUrlFor({ baseUrl: webhookBaseUrl, providerId: provider.id }),
    returnUrl,
  });

  const tables = <T>(fn: (db: Kysely<LipayTables>) => Promise<T>): Promise<T> =>
    kernel.run((k) => fn(k.withTables<LipayTables>()));
  const paymentLock = (paymentId: string): Promise<void> => kernel.lockKey(`${PAYMENTS}:${paymentId}`);

  const selectPaymentById = (scope: string, id: string): Promise<PaymentRow | undefined> =>
    tables((db) => db.selectFrom(PAYMENTS).selectAll().where("workspace_id", "=", scope).where("id", "=", id).executeTakeFirst());
  const selectPaymentByKey = (scope: string, key: string): Promise<PaymentRow | undefined> =>
    tables((db) =>
      db.selectFrom(PAYMENTS).selectAll().where("workspace_id", "=", scope).where("idempotency_key", "=", key).executeTakeFirst()
    );
  const selectPaymentByRef = (providerId: string, providerRef: string): Promise<PaymentRow | undefined> =>
    tables((db) =>
      db
        .selectFrom(PAYMENTS)
        .selectAll()
        .where("provider_id", "=", providerId)
        .where("provider_ref", "=", providerRef)
        .where("workspace_id", "=", workspaceId)
        .executeTakeFirst()
    );
  const selectRefundByKey = (scope: string, key: string): Promise<RefundRow | undefined> =>
    tables((db) =>
      db.selectFrom(REFUNDS).selectAll().where("workspace_id", "=", scope).where("idempotency_key", "=", key).executeTakeFirst()
    );
  const selectPaymentByRowId = (id: string): Promise<PaymentRow | undefined> =>
    tables((db) => db.selectFrom(PAYMENTS).selectAll().where("id", "=", id).executeTakeFirst());

  const readPayment = async (id: string): Promise<PaymentRecord | null> => {
    const row = await selectPaymentByRowId(id);
    return row ? toPaymentRecord(row) : null;
  };

  async function resolveCredentials(
    provider: PaymentProvider,
    scope: string
  ): Promise<Readonly<Record<string, string>> | null> {
    return credentials.getCredentials({ workspaceId: scope, providerId: provider.id, keys: provider.credentialKeys });
  }

  /**
   * Inserts the pending payment row, absorbing the race where a concurrent request holding the
   * same idempotency key wins the UNIQUE index first (see the module-level idempotency contract).
   */
  async function insertPendingPayment(
    id: string,
    input: ChargeRequest,
    createdAt: number
  ): Promise<{ kind: "inserted" } | { kind: "raced"; row: PaymentRow }> {
    const inserted = await tables((db) =>
      db
        .insertInto(PAYMENTS)
        .values({
          id,
          workspace_id: input.workspaceId,
          provider_id: input.providerId,
          idempotency_key: input.idempotencyKey,
          status: "pending",
          amount_minor: input.amount.minorUnits,
          currency: input.amount.currency,
          amount_refunded_minor: 0,
          provider_ref: null,
          reference: input.reference ?? null,
          created_at: createdAt,
          updated_at: createdAt,
          last_error: null,
        })
        .onConflict((oc) => oc.columns(["workspace_id", "idempotency_key"]).doNothing())
        .executeTakeFirst()
    );
    if (Number(inserted.numInsertedOrUpdatedRows ?? 0n) > 0) return { kind: "inserted" };
    // Lost the race to a concurrent request holding the same key — the unique index is the
    // arbiter, so re-read and treat it as the replay it is.
    const raced = await selectPaymentByKey(input.workspaceId, input.idempotencyKey);
    if (!raced) throw new Error(`lipay: payment insert for key '${input.idempotencyKey}' conflicted but no row holds the key`);
    return { kind: "raced", row: raced };
  }

  async function charge(input: ChargeRequest, _optional: Record<string, never> = {}): Promise<ChargeResult> {
    const provider = registry.get({ id: input.providerId });
    if (!provider) {
      return {
        ok: false,
        payment: null,
        error: error("PROVIDER_NOT_REGISTERED", `no payment provider registered for '${input.providerId}'`),
      };
    }

    const validationError = validateChargeInput(provider, input);
    if (validationError) {
      return { ok: false, payment: null, error: validationError };
    }

    // Outbound idempotency, checked BEFORE the provider is called. The case a naive
    // "just return the stored row" implementation gets wrong is the second branch.
    const existing = await selectPaymentByKey(input.workspaceId, input.idempotencyKey);
    const existingResult = resolveExistingCharge(existing, input);
    if (existingResult) return existingResult;

    const resolved = await resolveCredentials(provider, input.workspaceId);
    if (!resolved) {
      // Nothing is persisted: a payment that could never be attempted is not a payment attempt.
      return {
        ok: false,
        payment: null,
        error: error("NO_CREDENTIALS_CONFIGURED", `no credentials configured for payment provider '${provider.id}'`),
      };
    }

    const id = idGen.newId();
    const createdAt = clock.now();
    const insertOutcome = await insertPendingPayment(id, input, createdAt);
    if (insertOutcome.kind === "raced") {
      return { ok: true, payment: toPaymentRecord(insertOutcome.row), next: null, replayed: true };
    }

    const result = await provider.createCharge(buildChargeProviderRequest(input), contextFor(provider, resolved));

    const updatedAt = clock.now();
    if (!result.ok) {
      const lastError = `${result.error.code}: ${result.error.message}`;
      await tables((db) =>
        db.updateTable(PAYMENTS).set({ status: "failed", updated_at: updatedAt, last_error: lastError }).where("id", "=", id).execute()
      );
      return { ok: false, payment: await readPayment(id), error: result.error };
    }

    await tables((db) =>
      db
        .updateTable(PAYMENTS)
        .set({ status: result.status, provider_ref: result.providerRef, updated_at: updatedAt })
        .where("id", "=", id)
        .execute()
    );
    const payment = await readPayment(id);
    if (!payment) throw new Error(`lipay: payment ${id} vanished immediately after write`);
    return { ok: true, payment, next: result.next, replayed: false };
  }

  /** Provider lookup plus its refund-capability gate — the two checks every refund needs before
   * anything else can be resolved. */
  function resolveRefundProvider(payment: PaymentRecord): { ok: true; provider: PaymentProvider } | { ok: false; error: PaymentError } {
    const provider = registry.get({ id: payment.providerId });
    if (!provider) {
      return { ok: false, error: error("PROVIDER_NOT_REGISTERED", `no payment provider registered for '${payment.providerId}'`) };
    }
    if (provider.capabilities.refunds === "none" || typeof provider.refund !== "function") {
      return { ok: false, error: error("CAPABILITY_UNSUPPORTED", `provider '${provider.id}' does not support refunds`) };
    }
    return { ok: true, provider };
  }

  /** Credentials plus the provider-ref precondition — both must hold before a refund attempt can
   * be persisted and dispatched. */
  async function resolveRefundPrereqs(
    provider: PaymentProvider,
    payment: PaymentRecord,
    workspaceId: string
  ): Promise<{ ok: true; credentials: Readonly<Record<string, string>> } | { ok: false; error: PaymentError }> {
    const resolved = await resolveCredentials(provider, workspaceId);
    if (!resolved) {
      return { ok: false, error: error("NO_CREDENTIALS_CONFIGURED", `no credentials configured for payment provider '${provider.id}'`) };
    }
    if (!payment.providerRef) {
      return { ok: false, error: error("INVALID_REQUEST", `payment ${payment.id} has no provider reference to refund`) };
    }
    return { ok: true, credentials: resolved };
  }

  /**
   * Inserts the pending refund row, absorbing the same UNIQUE-index race `insertPendingPayment`
   * absorbs on the charge side.
   */
  async function insertPendingRefund(
    refundId: string,
    input: RefundRequest,
    amount: Money,
    createdAt: number
  ): Promise<{ kind: "inserted" } | { kind: "raced"; row: RefundRow }> {
    const inserted = await tables((db) =>
      db
        .insertInto(REFUNDS)
        .values({
          id: refundId,
          workspace_id: input.workspaceId,
          payment_id: input.paymentId,
          idempotency_key: input.idempotencyKey,
          provider_ref: null,
          amount_minor: amount.minorUnits,
          currency: amount.currency,
          status: "pending",
          reason: input.reason ?? null,
          created_at: createdAt,
          updated_at: createdAt,
        })
        .onConflict((oc) => oc.columns(["workspace_id", "idempotency_key"]).doNothing())
        .executeTakeFirst()
    );
    if (Number(inserted.numInsertedOrUpdatedRows ?? 0n) > 0) return { kind: "inserted" };
    const raced = await selectRefundByKey(input.workspaceId, input.idempotencyKey);
    if (!raced) throw new Error(`lipay: refund insert for key '${input.idempotencyKey}' conflicted but no row holds the key`);
    return { kind: "raced", row: raced };
  }

  /** Reserve refundable money before calling the provider. Pending rows count against the
   * balance under the payment lock, so distinct in-flight keys cannot spend the same money. */
  function reserveRefund(
    refundId: string,
    input: RefundRequest,
    amount: Money,
    createdAt: number
  ): Promise<Awaited<ReturnType<typeof insertPendingRefund>> | { kind: "refused"; error: PaymentError }> {
    return kernel.transaction(async () => {
      await paymentLock(input.paymentId);
      const existing = await selectRefundByKey(input.workspaceId, input.idempotencyKey);
      if (existing) return { kind: "raced", row: existing };
      const current = await readPayment(input.paymentId);
      if (!current) throw new Error(`lipay: payment ${input.paymentId} vanished before refund reservation`);
      const statusError = validateRefundStatus(current);
      if (statusError) return { kind: "refused", error: statusError };
      const pending = await tables((db) => db.selectFrom(REFUNDS)
        .select((eb) => eb.fn.sum<number>("amount_minor").as("reserved"))
        .where("workspace_id", "=", input.workspaceId)
        .where("payment_id", "=", input.paymentId)
        .where("status", "=", "pending")
        .executeTakeFirstOrThrow());
      const remaining = current.amount.minorUnits - current.amountRefundedMinor - Number(pending.reserved ?? 0);
      if (amount.minorUnits > remaining) {
        return { kind: "refused", error: error("INVALID_REQUEST", `refund of ${amount.minorUnits} exceeds the ${remaining} still refundable on payment ${input.paymentId}`) };
      }
      return insertPendingRefund(refundId, input, amount, createdAt);
    });
  }

  /**
   * Everything from "the refund row now exists" onward: call the provider, mark the row on
   * failure, or move the refund row and the payment's refunded total together on success. Split
   * out of `refund()` because this is the one stretch that cannot be reduced to a single guard
   * clause — it is the actual attempt, not a precondition on it.
   */
  async function executeRefundAttempt(args: {
    refundId: string;
    input: RefundRequest;
    amount: Money;
    payment: PaymentRecord;
    provider: PaymentProvider;
    resolvedCredentials: Readonly<Record<string, string>>;
    createdAt: number;
  }): Promise<RefundResult> {
    const { refundId, input, amount, payment, provider, resolvedCredentials, createdAt } = args;

    const insertOutcome = await reserveRefund(refundId, input, amount, createdAt);
    if (insertOutcome.kind === "refused") return { ok: false, error: insertOutcome.error };
    if (insertOutcome.kind === "raced") {
      return { ok: true, refund: toRefundRecord(insertOutcome.row), payment, replayed: true };
    }

    // `resolveRefundPrereqs` already rejected a payment with no `providerRef`, so this call is
    // reached only when one is set — the assertion documents that instead of re-deriving it.
    const result = await provider.refund!(
      {
        providerRef: payment.providerRef as string,
        amount,
        idempotencyKey: input.idempotencyKey,
        ...(input.reason === undefined ? {} : { reason: input.reason }),
      },
      contextFor(provider, resolvedCredentials)
    );

    const updatedAt = clock.now();
    if (!result.ok) {
      await tables((db) => db.updateTable(REFUNDS).set({ status: "failed", updated_at: updatedAt }).where("id", "=", refundId).execute());
      return { ok: false, error: result.error };
    }

    // The refund row and the payment's refunded total move together or not at all. The payment is
    // re-read under its lock: the provider call above took real time, and a webhook may have moved
    // the refunded total meanwhile.
    await kernel.transaction(async () => {
      await tables((db) =>
        db
          .updateTable(REFUNDS)
          .set({ status: result.status, provider_ref: result.providerRef, updated_at: updatedAt })
          .where("id", "=", refundId)
          .execute()
      );
      if (result.status !== "succeeded") return;
      await paymentLock(payment.id);
      const current = await readPayment(payment.id);
      if (!current) throw new Error(`lipay: payment ${payment.id} vanished during refund`);
      const refundedTotal = current.amountRefundedMinor + amount.minorUnits;
      const next = refundedTotal >= current.amount.minorUnits ? "refunded" : "partially_refunded";
      // A second partial refund moves the money without moving the status, so the total is written
      // either way and the status only when the machine actually allows the step.
      const status = canTransition({ from: current.status, to: next }) ? { status: next } : {};
      await tables((db) =>
        db
          .updateTable(PAYMENTS)
          .set({ amount_refunded_minor: refundedTotal, ...status, updated_at: updatedAt })
          .where("id", "=", payment.id)
          .execute()
      );
    });

    const refundRow = await tables((db) => db.selectFrom(REFUNDS).selectAll().where("id", "=", refundId).executeTakeFirstOrThrow());
    const after = await readPayment(payment.id);
    if (!after) throw new Error(`lipay: payment ${payment.id} vanished immediately after refund`);
    return { ok: true, refund: toRefundRecord(refundRow), payment: after, replayed: false };
  }

  async function refund(input: RefundRequest, _optional: Record<string, never> = {}): Promise<RefundResult> {
    const paymentRow = await selectPaymentById(input.workspaceId, input.paymentId);
    if (!paymentRow) {
      return { ok: false, error: error("INVALID_REQUEST", `no payment '${input.paymentId}' in this workspace`) };
    }
    const payment = toPaymentRecord(paymentRow);

    const providerResolution = resolveRefundProvider(payment);
    if (!providerResolution.ok) return { ok: false, error: providerResolution.error };
    const { provider } = providerResolution;

    const statusError = validateRefundStatus(payment);
    if (statusError) return { ok: false, error: statusError };

    const amountResolution = resolveRefundAmount(input, payment, provider);
    if (!amountResolution.ok) return { ok: false, error: amountResolution.error };
    const { amount } = amountResolution;

    const existing = await selectRefundByKey(input.workspaceId, input.idempotencyKey);
    const existingResult = resolveExistingRefund(existing, input, amount, payment);
    if (existingResult) return existingResult;

    const prereqs = await resolveRefundPrereqs(provider, payment, input.workspaceId);
    if (!prereqs.ok) return { ok: false, error: prereqs.error };

    return executeRefundAttempt({
      refundId: idGen.newId(),
      input,
      amount,
      payment,
      provider,
      resolvedCredentials: prereqs.credentials,
      createdAt: clock.now(),
    });
  }

  /**
   * Inserts one inbound event row, absorbing the UNIQUE-index dedupe on `(provider_id,
   * provider_event_id)` — the whole inbound idempotency mechanism (see `activateLipay`'s doc).
   */
  async function insertPaymentEvent(
    providerId: PaymentProviderId,
    event: NormalizedPaymentEvent,
    payload: string,
    paymentId: string | null
  ): Promise<{ kind: "duplicate" } | { kind: "inserted"; eventId: string; receivedAt: number }> {
    const eventId = idGen.newId();
    const receivedAt = clock.now();
    const inserted = await tables((db) =>
      db
        .insertInto(EVENTS)
        .values({
          id: eventId,
          workspace_id: workspaceId,
          provider_id: providerId,
          provider_event_id: event.providerEventId,
          payment_id: paymentId,
          kind: event.kind,
          occurred_at: event.occurredAt,
          received_at: receivedAt,
          applied: 0,
          payload,
        })
        .onConflict((oc) => oc.columns(["provider_id", "provider_event_id"]).doNothing())
        .executeTakeFirst()
    );
    return Number(inserted.numInsertedOrUpdatedRows ?? 0n) > 0 ? { kind: "inserted", eventId, receivedAt } : { kind: "duplicate" };
  }

  /** The payment an event names, locked for the rest of the transaction and read fresh under it. */
  async function lockedPaymentForEvent(providerId: PaymentProviderId, event: NormalizedPaymentEvent): Promise<PaymentRow | undefined> {
    const found = await selectPaymentByRef(providerId, event.providerRef);
    if (!found) return undefined;
    await paymentLock(found.id);
    return selectPaymentByRowId(found.id);
  }

  /**
   * Apply one normalized event. Everything below the INSERT runs only because the INSERT succeeded,
   * i.e. only for an event this install has never seen — which is why no code path here needs its
   * own "have I already handled this?" branch.
   */
  function applyEvent(providerId: PaymentProviderId, event: NormalizedPaymentEvent, payload: string): Promise<"duplicate" | "applied" | "recorded"> {
    return kernel.transaction(async (): Promise<"duplicate" | "applied" | "recorded"> => {
      const paymentRow = await lockedPaymentForEvent(providerId, event);
      const inserted = await insertPaymentEvent(providerId, event, payload, paymentRow === undefined ? null : paymentRow.id);
      if (inserted.kind === "duplicate") return "duplicate";

      if (!paymentRow) return "recorded";

      // Out-of-order rejection: an event older than the newest one already applied to this payment
      // is recorded for the audit trail but never allowed to move the state backwards.
      const lastApplied = await tables((db) =>
        db
          .selectFrom(EVENTS)
          .select((eb) => eb.fn.max("occurred_at").as("at"))
          .where("payment_id", "=", paymentRow.id)
          .where("applied", "=", 1)
          .executeTakeFirstOrThrow()
      );

      const transition = computeEventTransition(paymentRow, event, lastApplied.at === null ? null : Number(lastApplied.at));
      if (!transition.apply) return "recorded";

      // Two statements rather than one that restates the current status: this is the same pair
      // `executeRefundAttempt` writes on the direct `refund()` path, and the whole point of
      // `next: null` is that the status column is not part of this event's effect.
      const status = transition.next === null ? {} : { status: transition.next };
      await tables((db) =>
        db
          .updateTable(PAYMENTS)
          .set({ ...status, amount_refunded_minor: transition.refundedTotal, updated_at: inserted.receivedAt })
          .where("id", "=", paymentRow.id)
          .execute()
      );
      await tables((db) => db.updateTable(EVENTS).set({ applied: 1 }).where("id", "=", inserted.eventId).execute());
      return "applied";
    });
  }

  async function handleWebhook(input: {
    providerId: PaymentProviderId;
    rawBody: Buffer;
    headers: Readonly<Record<string, string>>;
  }, _optional: Record<string, never> = {}): Promise<WebhookAck> {
    const provider = registry.get({ id: input.providerId });
    if (!provider) {
      return {
        accepted: false,
        processed: 0,
        duplicates: 0,
        error: error("PROVIDER_NOT_REGISTERED", `no payment provider registered for '${input.providerId}'`),
      };
    }

    const resolved = await resolveCredentials(provider, workspaceId);
    if (!resolved) {
      return {
        accepted: false,
        processed: 0,
        duplicates: 0,
        error: error("NO_CREDENTIALS_CONFIGURED", `no credentials configured for payment provider '${provider.id}'`),
      };
    }

    const parsed = await provider.parseWebhook(
      { rawBody: input.rawBody, headers: input.headers },
      contextFor(provider, resolved)
    );
    if (!parsed.ok) {
      return { accepted: false, processed: 0, duplicates: 0, error: parsed.error };
    }

    const payload = input.rawBody.toString("utf8");
    let processed = 0;
    let duplicates = 0;
    for (const event of parsed.events) {
      const outcome = await applyEvent(provider.id, event, payload);
      if (outcome === "duplicate") duplicates += 1;
      else processed += 1;
    }
    // Accepted even when no event matched a known payment or a known event type: log-and-accept
    // beats an infinite provider retry storm, which is the one instinct both studied systems share.
    return { accepted: true, processed, duplicates };
  }

  return {
    listProviders(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): readonly PaymentProviderSummary[] {
      return registry.list().map((provider) => ({
        id: provider.id,
        displayName: provider.displayName,
        capabilities: provider.capabilities,
      }));
    },
    charge,
    refund,
    handleWebhook,
    async getPayment(request: { workspaceId: string; id: string }, _optional: Record<string, never> = {}): Promise<PaymentRecord | null> {
      const row = await selectPaymentById(request.workspaceId, request.id);
      return row ? toPaymentRecord(row) : null;
    },
    async listPayments(request: { workspaceId: string }, optional: { limit?: (number) | undefined } = {}): Promise<readonly PaymentRecord[]> {
      const limit = Math.min(Math.max(optional.limit ?? 50, 1), 500);
      const rows = await tables((db) =>
        db.selectFrom(PAYMENTS).selectAll().where("workspace_id", "=", request.workspaceId).orderBy("created_at", "desc").limit(limit).execute()
      );
      return rows.map((row) => toPaymentRecord(row));
    },
  };
}
