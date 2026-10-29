/**
 * @file A deterministic LiPay FAKE on the new provider contract: an in-memory LiPay "server" plus a
 * `PaymentProvider` that talks to it. LiPay has no live API (design: "LiPay stays a contract-tested
 * fake until its real API exists"), so this is where the kernel's race and property tests get a
 * provider whose timing they control: the test decides whether a call answers, times out (money
 * moved, outcome `unknown`) or is rejected, and when each webhook is delivered.
 *
 * It reuses LiPay's real webhook signing (`signLipayWebhook`: timestamped HMAC-SHA256 over the
 * exact bytes, header `x-lipay-signature`), so `verifyWebhook` exercises a real signature check.
 * The payload shapes are this fake's own; LiPay's real ones do not exist yet.
 */
import { timingSafeEqual } from "node:crypto";
import type { HttpClientPort } from "@jini-ai/core/primitives";
import type { Money } from "../../money/money.js";
import type { PaymentEvidence, RefundEvidence, WebhookFact } from "../contract/evidence.js";
import { paymentError, type Outcome, type PaymentProvider, type ProviderContext } from "../contract/provider.js";
import { signLipayWebhook } from "../providers/lipay-gateway.js";

/** What the next call of an operation does. `timeout` = the server ACTS but the caller never hears back. */
export type FakeBehaviour = "ok" | "timeout" | "reject";

interface FakeRefund { id: string; chargeId: string; amount: Money; status: "pending" | "succeeded" | "failed"; correlationId: string }
interface FakeCharge { id: string; amount: Money; status: PaymentEvidence["status"]; correlationId: string }

export interface LipayFakeServer {
  /** Queue behaviours for the next calls of an operation (default `ok`). */
  script(required: { op: "createIntent" | "refund"; behaviours: readonly FakeBehaviour[] }, optional?: Record<string, never>): void;
  /** Move a refund to a new status at the "provider" (e.g. pending → succeeded, succeeded → failed). */
  settleRefund(required: { refundId: string; status: FakeRefund["status"] }, optional?: Record<string, never>): void;
  /** A signed webhook delivery for a refund (`refund.updated`) or the charge with all its refunds (`charge.refunded`). */
  webhook(
    required: { type: "refund.updated" | "charge.refunded" | "charge.succeeded"; id: string; eventId: string },
    optional?: { echoCorrelation?: boolean }
  ): { rawBody: Uint8Array; headers: Record<string, string> };
  /** Snapshot of a refund as the provider holds it. */
  refundOf(required: { refundId: string }, optional?: Record<string, never>): Readonly<FakeRefund> | undefined;
}

export const LIPAY_FAKE_SECRET = "whsec_lipay_fake";
const HEADER = "x-lipay-signature";

function nextBehaviour(queue: FakeBehaviour[]): FakeBehaviour {
  return queue.shift() ?? "ok";
}

function refundEvidence(refund: FakeRefund, echo: boolean): RefundEvidence {
  return { providerRefundRef: refund.id, amount: refund.amount, status: refund.status, ...(echo ? { correlationId: refund.correlationId } : {}) };
}

function verify(required: { rawBody: Uint8Array; header: string | undefined; secret: string | undefined; nowMs: number }): boolean {
  const match = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(required.header ?? "");
  if (!match || !required.secret) return false;
  const expected = signLipayWebhook({ secret: required.secret, rawBody: Buffer.from(required.rawBody), timestampSeconds: Number(match[1]) });
  const ok = timingSafeEqual(Buffer.from(expected), Buffer.from(`t=${match[1]},v1=${match[2]}`));
  return ok && Math.abs(required.nowMs - Number(match[1]) * 1000) <= 300_000;
}

const unknown = () => ({ kind: "unknown" as const, error: paymentError({ code: "TRANSPORT_ERROR", message: "lipay fake: timed out" }, { retryable: true }) });
// Fake-local: core must not know which providers are test doubles.
const liveRefusal = () => ({ kind: "rejected" as const, error: paymentError({ code: "INVALID_REQUEST", message: "LiPay fake is test-only" }) });
const rejected = (message: string) => ({ kind: "rejected" as const, error: paymentError({ code: "DECLINED", message }) });

/**
 * Builds the fake server and its provider. `now` is the test's clock (epoch ms).
 * Every operation refuses live mode before touching state or consuming scripted outcomes.
 * @complexity O(1) setup; evidence snapshots use O(r) time/space for the fake's r refunds. No external I/O.
 */
export function createLipayFake(
  { now }: { now: () => number },
  optional: { echoesCorrelation?: boolean } = {}
): { server: LipayFakeServer; provider: PaymentProvider } {
  const echo = optional.echoesCorrelation ?? true;
  const charges = new Map<string, FakeCharge>();
  const refunds = new Map<string, FakeRefund>();
  const scripts: Record<"createIntent" | "refund", FakeBehaviour[]> = { createIntent: [], refund: [] };
  let seq = 0;

  const chargeEvidence = (charge: FakeCharge, withEcho: boolean): PaymentEvidence => ({
    providerRef: charge.id, status: charge.status, amount: charge.amount,
    ...(withEcho ? { correlationId: charge.correlationId } : {}),
    refunds: [...refunds.values()].filter((r) => r.chargeId === charge.id).map((r) => refundEvidence(r, withEcho)),
    disputes: [],
  });

  const factFor = (body: { type: string; id: string; eventId: string; echo: boolean }): WebhookFact => {
    const refund = refunds.get(body.id);
    const charge = charges.get(refund?.chargeId ?? body.id) as FakeCharge;
    const evidence = chargeEvidence(charge, body.echo);
    const only = body.type === "refund.updated" && refund ? { ...evidence, refunds: [refundEvidence(refund, body.echo)] } : evidence;
    return { providerEventId: body.eventId, providerRef: charge.id, evidence: only };
  };

  const server: LipayFakeServer = {
    script: ({ op, behaviours }) => { scripts[op].push(...behaviours); },
    settleRefund: ({ refundId, status }) => { (refunds.get(refundId) as FakeRefund).status = status; },
    refundOf: ({ refundId }) => refunds.get(refundId),
    webhook: ({ type, id, eventId }, o = {}) => {
      const rawBody = Buffer.from(JSON.stringify({ type, id, eventId, echo: o.echoCorrelation ?? echo }));
      return { rawBody, headers: { [HEADER]: signLipayWebhook({ secret: LIPAY_FAKE_SECRET, rawBody, timestampSeconds: Math.floor(now() / 1000) }) } };
    },
  };

  const provider: PaymentProvider = {
    id: "lipay",
    displayName: "LiPay (fake)",
    credentialKeys: ["webhookSecret"],
    capabilities: {
      refunds: "partial", capture: "auto", void: false, disputes: false, retrieve: "payment+refunds",
      echoesCorrelation: echo, confirmation: ["none"], currencies: "any",
    },
    createIntent: async ({ req, ctx }, _optional = {}) => {
      if (ctx.account.mode === "live") return liveRefusal();
      const behaviour = nextBehaviour(scripts.createIntent);
      if (behaviour === "reject") return rejected("card_declined");
      const charge: FakeCharge = { id: `ch_${++seq}`, amount: req.amount, status: "succeeded", correlationId: req.correlationId };
      charges.set(charge.id, charge);
      if (behaviour === "timeout") return unknown();
      return { kind: "ok", value: { evidence: chargeEvidence(charge, echo), next: { kind: "none" } } };
    },
    refund: async ({ req, ctx }, _optional = {}) => {
      if (ctx.account.mode === "live") return liveRefusal();
      const behaviour = nextBehaviour(scripts.refund);
      if (behaviour === "reject") return rejected("refund refused");
      const refund: FakeRefund = { id: `re_${++seq}`, chargeId: req.providerRef, amount: req.amount, status: "pending", correlationId: req.correlationId };
      refunds.set(refund.id, refund);
      return behaviour === "timeout" ? unknown() : { kind: "ok", value: refundEvidence(refund, echo) };
    },
    retrieve: async ({ providerRef, ctx }, _optional = {}): Promise<Outcome<PaymentEvidence>> => {
      if (ctx.account.mode === "live") return liveRefusal();
      const charge = charges.get(providerRef);
      return charge ? { kind: "ok", value: chargeEvidence(charge, echo) } : rejected(`no charge ${providerRef}`);
    },
    verifyWebhook: async ({ rawBody, headers, ctx }: { rawBody: Uint8Array; headers: Readonly<Record<string, string>>; ctx: ProviderContext }, _optional = {}) => {
      if (ctx.account.mode === "live") return liveRefusal();
      if (!verify({ rawBody, header: headers[HEADER], secret: ctx.credentials.webhookSecret, nowMs: ctx.now() })) {
        return { kind: "rejected", error: paymentError({ code: "SIGNATURE_INVALID", message: "lipay fake: bad signature" }) };
      }
      const body = JSON.parse(Buffer.from(rawBody).toString("utf8")) as { type: string; id: string; eventId: string; echo: boolean };
      return { kind: "ok", value: [factFor(body)] };
    },
  };
  return { server, provider };
}

/** A `ProviderContext` for the fake: the fake secret and a test clock. The fake makes no HTTP calls, so the port is empty. */
export function lipayFakeContext({ now }: { now: () => number }, _optional: Record<string, never> = {}): ProviderContext {
  const httpClient = {} as HttpClientPort;
  return {
    credentials: { webhookSecret: LIPAY_FAKE_SECRET }, account: { providerAccountId: "acct_fake", mode: "test" },
    httpClient, now, webhookUrl: "https://example.test/payments/webhook/site/lipay", returnUrl: "https://example.test/return", cancelUrl: "https://example.test/cancel",
  };
}

