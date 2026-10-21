/**
 * @file What the payments agent tools (lot L7) are built from, all injected by the host: the
 * consumer `PaymentsPort`, the grant minter, the run → payment-scope resolver, the permission
 * evaluator, the human-approval transport, the clock and the idempotency-key source.
 *
 * The scope comes from the run (`scopeFor`), never from tool input: which workspace, site, provider
 * account and live/test mode a run acts for is the host's binding, and a model that could name its
 * own scope could act on another tenant's or the live account's money.
 */
import {
  adaptLegacyAuthorize, requireToolPermission, type ApprovalSteps, type LegacyToolAuthorizeFn, type ToolExecutionContext,
} from "@jini-ai/core";
import type { Money } from "../../money/money.js";
import type { PaymentsPort } from "../contract/payments-port.js";
import type { PaymentMode, PaymentScope } from "../contract/scope.js";
import type { MoneyGrantPort } from "../ops/grants.js";
import { DEFAULT_PAYMENTS_TOOL_PERMISSIONS, type PaymentsToolPermissions } from "./catalog.js";

/** What the human is shown before any money moves. The host renders it; core never formats it. */
export interface PaymentApprovalDescription {
  readonly toolId: string;
  readonly operation: "refund" | "capture" | "void";
  readonly mode: PaymentMode;
  /** True for live mode: real money. Hosts are expected to render this prominently. */
  readonly live: boolean;
  readonly paymentId: string;
  readonly reference: string;
  readonly providerId: string;
  /** The amount this operation moves; `null` for a void (it releases the whole authorization). */
  readonly amount: Money | null;
  /** `amount` for people (`"USD 12.34"`), or `null`. */
  readonly amountDisplay: string | null;
  readonly paymentAmount: Money;
  readonly paymentAmountDisplay: string;
  /** The exact key the effect will use; shown so a retry can be recognized as the same request. */
  readonly idempotencyKey: string;
  readonly reason: string | null;
  /** Money movements cannot be undone, so no approval is ever remembered. */
  readonly irreversible: true;
  /** One sentence naming all of the above. */
  readonly summary: string;
}

export interface PaymentsToolsRequired {
  readonly payments: PaymentsPort;
  /** Only `mint`: the tools never redeem; the payments service does, itself. */
  readonly grants: Pick<MoneyGrantPort, "mint">;
  /** The payment scope this run acts for, or `null` when it is bound to none. Never read from input. */
  readonly scopeFor: (required: { ctx: ToolExecutionContext }, optional?: Record<string, never>) => PaymentScope | null | Promise<PaymentScope | null>;
  /** The host's permission evaluator (the same shape the admin routes use). */
  readonly authorize: LegacyToolAuthorizeFn;
  /** The host's approval transport (e.g. a confirmation card). */
  readonly askHuman: ApprovalSteps<unknown, PaymentApprovalDescription>["askHuman"];
  readonly now: () => number;
  /** A fresh, unguessable idempotency key, used when the input supplies none. */
  readonly newIdempotencyKey: () => string;
}

export interface PaymentsToolsOptional {
  /** How long a minted grant stays redeemable (ms). Default 2 minutes: it is spent at once. */
  readonly grantTtlMs?: number;
  readonly permissions?: Partial<PaymentsToolPermissions>;
}

export interface ToolsDeps extends PaymentsToolsRequired {
  readonly grantTtlMs: number;
  readonly permissions: PaymentsToolPermissions;
}

export const DEFAULT_GRANT_TTL_MS = 120_000;

/** @throws {RangeError} When `grantTtlMs` is not a positive whole number of milliseconds. */
export function resolveToolsDeps(required: PaymentsToolsRequired, optional: PaymentsToolsOptional = {}): ToolsDeps {
  const grantTtlMs = optional.grantTtlMs ?? DEFAULT_GRANT_TTL_MS;
  if (!Number.isSafeInteger(grantTtlMs) || grantTtlMs <= 0) throw new RangeError("commerce payments tools: grantTtlMs must be a positive whole number of milliseconds");
  return { ...required, grantTtlMs, permissions: { ...DEFAULT_PAYMENTS_TOOL_PERMISSIONS, ...optional.permissions } };
}

/** Why a tool did nothing. Every refusal says that no money moved. */
export type PaymentsToolRefusalReason = "no-payment-scope" | "payment-not-found" | "currency-mismatch";

export interface PaymentsToolRefusal {
  readonly ok: false;
  readonly reason: PaymentsToolRefusalReason;
  readonly message: string;
}

export const NO_SCOPE: PaymentsToolRefusal = {
  ok: false, reason: "no-payment-scope", message: "this run is not bound to a payment account; nothing was read or changed",
};

export function paymentNotFound(paymentId: string): PaymentsToolRefusal {
  return { ok: false, reason: "payment-not-found", message: `no payment '${paymentId}' in this payment account; nothing was changed` };
}

/**
 * Runs the permission check the matching admin route would, against the run's workspace.
 * @throws {ToolPermissionDeniedError} When the evaluator denies.
 */
export function requirePaymentsPermission(
  { deps, ctx, scope, permission }: { deps: ToolsDeps; ctx: ToolExecutionContext; scope: PaymentScope; permission: string },
  optional: { paymentId?: string } = {}
): Promise<void> {
  return requireToolPermission(
    { authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: scope.workspaceId, principalId: ctx.principal.id, permission },
    { entityType: "payment", ...(optional.paymentId === undefined ? {} : { entityId: optional.paymentId }) }
  );
}
