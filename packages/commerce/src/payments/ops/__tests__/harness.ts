import type { HttpClientPort } from "@jini-ai/core/primitives";

import type { PaymentsAlert, PaymentsAlertPort } from "../../contract/alerts.js";
import type { PaymentEvidence, RefundEvidence } from "../../contract/evidence.js";
import { paymentError, type Outcome, type PaymentProvider, type ProviderCapabilities, type ProviderContext } from "../../contract/provider.js";
import type { PreChargeRiskPort, RiskFailPolicy } from "../../contract/risk.js";
import type { PaymentScope } from "../../contract/scope.js";
import type { PaymentsLedger } from "../../ledger/repo.js";
import { createKernelProviderRegistry, type ProviderContextPort } from "../../provider-registry.js";
import { createLipayFake, lipayFakeContext } from "../../testkit/lipay-fake.js";
import { openLedger, type LedgerKind } from "../../accounting/__tests__/harness.js";
import { createMemoryGrantStore, type MoneyGrantBinding } from "../grants.js";
import { resolveOpsDeps } from "../deps.js";
import { createPaymentsOperator, createPaymentsService } from "../service.js";

/**
 * @file Test harness for the payments operations: a real ledger (memory or SQL over SQLite), the
 * deterministic LiPay fake and a SCRIPTED provider for the paths LiPay does not have (manual
 * capture, void, full-only refunds, thrown or malformed answers), a context port, a grant store
 * and a recording alert sink — all injected, no module state.
 */

export const NOW = 1_800_000_000_000;
export const USD = (minorUnits: number) => ({ minorUnits, currency: "USD" });
export const LIPAY: PaymentScope = { workspaceId: "ws", siteId: "site", providerId: "lipay", providerAccountId: "acct_fake", mode: "test" };
export const SCRIPTED: PaymentScope = { ...LIPAY, providerId: "scripted" };

type Answer<T> = Outcome<T> | "throw" | "throw-value" | "garbage";
type Op = "createIntent" | "refund" | "capture" | "void" | "retrieve";

/** A provider whose every answer the test queues. Defaults: createIntent authorizes (manual) or succeeds (auto). */
export function scriptedProvider(capabilities: Partial<ProviderCapabilities> = {}, omit: readonly Op[] = []) {
  const queues: Record<Op, Answer<unknown>[]> = { createIntent: [], refund: [], capture: [], void: [], retrieve: [] };
  const calls: { op: Op; req: unknown; optional?: unknown }[] = [];
  const caps: ProviderCapabilities = {
    refunds: "partial", capture: "manual", void: true, disputes: false, retrieve: "payment", echoesCorrelation: true,
    confirmation: ["none"], currencies: ["USD"], ...capabilities,
  };
  const answer = async <T>(op: Op, req: unknown, fallback: () => Outcome<T>, optional?: unknown): Promise<Outcome<T>> => {
    calls.push({ op, req, ...(optional === undefined ? {} : { optional }) });
    const next = queues[op].shift() ?? fallback();
    if (next === "throw") throw new Error(`scripted ${op} exploded`);
    if (next === "throw-value") throw `scripted ${op} threw a string`;
    if (next === "garbage") return { nope: true } as unknown as Outcome<T>;
    return next as Outcome<T>;
  };
  const evidence = (over: Partial<PaymentEvidence> & { providerRef: string }): PaymentEvidence => ({ status: "authorized", refunds: [], disputes: [], ...over });
  const provider: PaymentProvider = {
    id: "scripted", displayName: "Scripted", credentialKeys: [], capabilities: caps,
    createIntent: ({ req }) => answer("createIntent", req, () => ({
      kind: "ok", value: { evidence: evidence({ providerRef: `sp_${req.correlationId}`, correlationId: req.correlationId, status: req.captureMode === "manual" ? "authorized" : "succeeded" }), next: { kind: "none" } },
    })),
    refund: ({ req }, optional) => answer<RefundEvidence>("refund", req, () => ({
      kind: "ok", value: { providerRefundRef: `sre_${req.correlationId}`, correlationId: req.correlationId, amount: req.amount, status: "succeeded" },
    }), optional),
    capture: ({ req }) => answer("capture", req, () => ({ kind: "ok", value: evidence({ providerRef: req.providerRef, status: "succeeded", captured: req.amount }) })),
    void: ({ req }) => answer("void", req, () => ({ kind: "ok", value: evidence({ providerRef: req.providerRef, status: "canceled" }) })),
    retrieve: ({ providerRef }) => answer("retrieve", providerRef, () => ({ kind: "ok", value: evidence({ providerRef }) })),
    verifyWebhook: async () => ({ kind: "rejected", error: paymentError({ code: "SIGNATURE_INVALID", message: "no" }) }),
  };
  for (const op of omit) delete (provider as unknown as Record<string, unknown>)[op];
  return {
    provider, calls,
    queue: (op: Op, ...answers: Answer<unknown>[]) => { queues[op].push(...answers); },
  };
}

export const rejected = (code: "DECLINED" | "INVALID_REQUEST" = "DECLINED") => ({ kind: "rejected" as const, error: paymentError({ code, message: "provider said no" }) });
export const timedOut = () => ({ kind: "unknown" as const, error: paymentError({ code: "TRANSPORT_ERROR", message: "timed out" }, { retryable: true }) });

export function recordingAlerts(optional: { fail?: boolean } = {}): PaymentsAlertPort & { raised: PaymentsAlert[] } {
  const raised: PaymentsAlert[] = [];
  return {
    raised,
    raise: async ({ alert }) => {
      raised.push(alert);
      if (optional.fail === true) throw new Error("sink down");
    },
  };
}

/** A controllable risk port: answers what the test sets, optionally after a gate opens. */
export function riskPort(verdict: "allow" | "review" | "deny", reasons: string[] = ["test.reason"]) {
  let release: () => void = () => undefined;
  const gate = { held: false, wait: Promise.resolve() };
  const port: PreChargeRiskPort = {
    assess: async () => {
      if (gate.held) await gate.wait;
      return { verdict, reasons };
    },
  };
  return {
    port,
    hold: () => { gate.held = true; gate.wait = new Promise<void>((resolve) => { release = resolve; }); },
    release: () => release(),
  };
}

export interface WorldOptions {
  readonly ledgerKind?: LedgerKind;
  readonly echoesCorrelation?: boolean;
  readonly scripted?: Partial<ProviderCapabilities>;
  /** Methods to remove from the scripted provider (a plugin that promises more than it implements). */
  readonly scriptedOmit?: readonly Op[];
  readonly risk?: { port: PreChargeRiskPort; failPolicy?: RiskFailPolicy };
  readonly alerts?: PaymentsAlertPort;
  /** Wrap the ledger (to inject races or faults). */
  readonly wrapLedger?: (ledger: PaymentsLedger) => PaymentsLedger;
}

/** Everything a service test needs, wired like a host would. */
export async function world(optional: WorldOptions = {}) {
  let clock = NOW;
  let seq = 0;
  const now = () => clock;
  const base = await openLedger(optional.ledgerKind ?? "memory");
  const ledger = optional.wrapLedger ? optional.wrapLedger(base) : base;
  const lipay = createLipayFake({ now }, optional.echoesCorrelation === undefined ? {} : { echoesCorrelation: optional.echoesCorrelation });
  const scripted = scriptedProvider(optional.scripted, optional.scriptedOmit);
  const providers = createKernelProviderRegistry({
    items: [{ pluginId: "lipay-plugin", module: lipay.provider }, { pluginId: "scripted-plugin", module: scripted.provider }],
  });
  const contextFailures = new Set<string>();
  const contexts: ProviderContextPort = {
    resolve: async ({ provider }) => {
      if (contextFailures.has(provider.id)) return { ok: false, error: paymentError({ code: "NO_CREDENTIALS_CONFIGURED", message: `no credentials for ${provider.id}` }) };
      const ctx: ProviderContext = provider.id === "lipay" ? lipayFakeContext({ now }) : {
        credentials: {}, account: { providerAccountId: "acct_fake", mode: "test" }, httpClient: {} as HttpClientPort, now,
        webhookUrl: "https://example.test/hook", returnUrl: "https://example.test/return", cancelUrl: "https://example.test/cancel",
      };
      return { ok: true, ctx };
    },
  };
  const grants = createMemoryGrantStore({ now, newToken: () => `grant_${++seq}` });
  const required = { ledger, providers, contexts, grants, now, newId: () => `id_${++seq}` };
  const risk = optional.risk
    ? { port: optional.risk.port, deadlineMs: 1_000, failPolicy: optional.risk.failPolicy ?? "closed", setTimer: () => ({ cancel: () => undefined }) }
    : undefined;
  const opts = { ...(risk ? { risk } : {}), ...(optional.alerts ? { alerts: optional.alerts } : {}) };
  const service = createPaymentsService(required, opts);
  /** The resolved dependency set, for calling an operation module directly. */
  const deps = resolveOpsDeps(required, opts);
  const operator = createPaymentsOperator(required, opts);
  return {
    ledger, lipay, scripted, providers, grants, service, operator, deps,
    tick: (ms: number) => { clock += ms; },
    failContextFor: (providerId: string) => contextFailures.add(providerId),
    /** Mints a grant for exactly this binding (what L7's approval flow does). */
    grant: (binding: Omit<MoneyGrantBinding, "workspaceId" | "mode"> & { scope?: PaymentScope }) => {
      const scope = binding.scope ?? LIPAY;
      const { scope: _ignored, ...rest } = binding;
      return grants.mint({ binding: { workspaceId: scope.workspaceId, mode: scope.mode, ...rest }, expiresAt: clock + 60_000 });
    },
    read: (paymentId: string) => ledger.transaction({ fn: async (tx) => ({
      payment: await tx.getPayment({ workspaceId: "ws", mode: "test", id: paymentId }),
      attempts: await tx.listAttempts({ paymentId }),
      refunds: await tx.listRefunds({ paymentId }),
      evidence: await tx.listEvidence({ paymentId }),
      actions: await tx.listOperatorActions({ paymentId }),
      quarantine: await tx.listQuarantine({ workspaceId: "ws", mode: "test" }),
      outbox: (await tx.listPendingOutbox({ limit: 100 })).map((m) => m.topic),
    }) }),
  };
}

export type World = Awaited<ReturnType<typeof world>>;

/** A succeeded $100 LiPay payment. */
export async function paidLipay(w: World, key = "ik-1") {
  const result = await w.service.createIntent({ scope: LIPAY, amount: USD(10_000), idempotencyKey: key, reference: "order-1" });
  if (!result.ok) throw new Error(`charge failed: ${result.error.message}`);
  return result.payment;
}

/** An authorized (manual capture) $100 scripted payment. */
export async function authorizedScripted(w: World, key = "ik-s") {
  const result = await w.service.createIntent({ scope: SCRIPTED, amount: USD(10_000), idempotencyKey: key, reference: "order-s" }, { captureMode: "manual" });
  if (!result.ok) throw new Error(`authorize failed: ${result.error.message}`);
  return result.payment;
}
