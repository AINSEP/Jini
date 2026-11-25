import { ForbiddenError, PlanStaleError, TokenAlreadyRedeemedError, TokenExpiredError } from "@jini-ai/core/gated-mutations";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { SameTermMergeError } from "../../../taxonomy/index.js";

/** @file Helpers shared by the three taxonomy merge-term ceremony specs (ADR-044's one gated mutation). */

/** The merge ceremony is always run by the signed-in operator, never an agent or API key. */
export const MERGE_PRINCIPAL_KIND = "user" as const;

/** What `plan` answers: the gateway's plan and the (re-derived) disclosure details. */
export interface MergePlanOutput { planId: string; planHash: string; details: unknown }

/** The host's binding of the gateway's `plan()` (it owns the hooks, token policy and storage). */
export type MergeGatewayPlanFn = (
  required: { principalId: string; principalKind: typeof MERGE_PRINCIPAL_KIND; fromTermId: string; intoTermId: string },
  _optional?: Record<string, never>,
) => Promise<MergePlanOutput>;

/** The host's binding of the gateway's `confirm()`; answers the minted token. */
export type MergeGatewayConfirmFn = (
  required: { principalId: string; principalKind: typeof MERGE_PRINCIPAL_KIND; planId: string; planHash: string },
  _optional?: Record<string, never>,
) => Promise<{ token: string }>;

/** The host's binding of the gateway's `execute()`; answers how many assignments were repointed. */
export type MergeGatewayExecuteFn = (
  required: { principalId: string; principalKind: typeof MERGE_PRINCIPAL_KIND; fromTermId: string; intoTermId: string; confirmationToken: string },
  _optional?: Record<string, never>,
) => Promise<{ mergedCount: number }>;

/** A request body read the way Express hands it over: absent means `{}`, any other value is read by property. */
export function mergeBody({ raw }: { raw: { body?: unknown } }, _optional: Record<string, never> = {}): Record<string, unknown> {
  return (raw.body ?? {}) as Record<string, unknown>;
}

/** The source term: `:id` (`intoTermId` travels in the body).
 * @complexity O(1). */
export function mergeFromTermId({ params }: { params: Record<string, string | undefined> }, _optional: Record<string, never> = {}): string {
  return String(params.id);
}

/** The flat 400 every malformed merge body answers with. */
export function rejectMergeValidation({ error }: { error: string }, _optional: Record<string, never> = {}): never {
  return rejectRoute({ status: 400, error, code: "VALIDATION_ERROR" });
}

type ErrorClass = abstract new (...args: never[]) => Error;
/** `code` omitted means the error's own `reasonCode` (a `ForbiddenError` carries the gateway's reason). */
interface MergeErrorRefusal { classes: readonly ErrorClass[]; status: number; code?: string }

/** The classified ceremony errors and the wire pair each answers. Every class is distinct, so the
 *  order carries no subclass hazard; the answer's `error` is always the error's own message. */
const MERGE_REFUSALS: readonly MergeErrorRefusal[] = [
  { classes: [ForbiddenError], status: 403 },
  { classes: [PlanStaleError], status: 409, code: "PLAN_STALE" },
  { classes: [TokenExpiredError], status: 409, code: "TOKEN_EXPIRED" },
  { classes: [TokenAlreadyRedeemedError], status: 409, code: "TOKEN_ALREADY_REDEEMED" },
  { classes: [SameTermMergeError], status: 400, code: "SAME_TERM_MERGE" },
];

/** Refuses a classified ceremony error with `{ error: message, code }`; anything else (including a
 *  thrown non-Error) is rethrown so the host's error port answers it as an unexpected failure.
 * @complexity O(n) in the refusal table. */
export function rejectMergeError({ err }: { err: unknown }, _optional: Record<string, never> = {}): never {
  const match = err instanceof Error ? MERGE_REFUSALS.find((refusal) => refusal.classes.some((cls) => err instanceof cls)) : undefined;
  if (!match) throw err;
  const code = match.code ?? (err as ForbiddenError).reasonCode;
  return rejectRoute({ status: match.status, error: (err as Error).message, code });
}
