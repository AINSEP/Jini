/**
 * @file Money grants (design item 8): the single-use permission a money-moving call (`refund`,
 * `capture`, `void`) must carry. The approval flow (L7 agent tools, after a human said yes) MINTS a
 * grant bound to the exact operation; the payments service REDEEMS it itself before reserving or
 * dispatching anything, rather than trusting the tool that collected the approval.
 *
 * Rules:
 * - The token is opaque and unguessable (the host injects `newToken`, e.g. 32 random bytes).
 * - Single use: the first matching redeem consumes it, atomically.
 * - Exact binding: op, workspace, mode, payment, amount (or none) and idempotency key must all be
 *   equal. A MISMATCHING redeem returns false and does NOT consume the grant, so a confused or
 *   hostile caller cannot burn a person's approval by presenting it for another operation.
 * - Expiry: a grant redeemed at or after `expiresAt` is refused (and stays unusable).
 *
 * Why the binding has no site or provider: the payment id is globally unique and the service checks
 * the payment's full scope against the call's, so they add nothing the payment id does not pin.
 */
import type { Money } from "../../money/money.js";
import type { PaymentMode } from "../contract/scope.js";

export interface MoneyGrantBinding {
  readonly op: "refund" | "capture" | "void";
  readonly workspaceId: string;
  readonly mode: PaymentMode;
  readonly paymentId: string;
  /** The exact amount approved; `null` for an operation without one (`void`). */
  readonly amount: Money | null;
  readonly idempotencyKey: string;
}

export interface MoneyGrantPort {
  /** Mints a single-use grant for `binding`, valid until `expiresAt` (epoch ms). Returns the opaque token. */
  mint(required: { binding: MoneyGrantBinding; expiresAt: number }, optional?: Record<string, never>): Promise<string>;
  /** True exactly once for an unexpired grant whose binding equals `binding`; consumes it then. */
  redeem(required: { grant: string; binding: MoneyGrantBinding }, optional?: Record<string, never>): Promise<boolean>;
}

const BINDING_FIELDS = ["op", "workspaceId", "mode", "paymentId", "idempotencyKey"] as const;

function sameAmount(a: Money | null, b: Money | null): boolean {
  if (a === null || b === null) return a === b;
  return a.minorUnits === b.minorUnits && a.currency === b.currency;
}

/** True when two bindings name the same operation, payment, amount and key. */
export function sameGrantBinding(
  { a, b }: { a: MoneyGrantBinding; b: MoneyGrantBinding },
  _optional: Record<string, never> = {}
): boolean {
  return sameAmount(a.amount, b.amount) && BINDING_FIELDS.every((field) => a[field] === b[field]);
}

interface StoredGrant {
  readonly binding: MoneyGrantBinding;
  readonly expiresAt: number;
}

/**
 * An in-process grant store: for tests and single-process hosts. A multi-process host binds a
 * durable `MoneyGrantPort` (same semantics; consume with a conditional delete/update).
 *
 * @throws From `mint` when `newToken` repeats a live token (a broken token source must not alias two approvals).
 * @example const grants = createMemoryGrantStore({ now: Date.now, newToken: () => randomBytes(32).toString("base64url") });
 */
export function createMemoryGrantStore(
  { now, newToken }: { now: () => number; newToken: () => string },
  _optional: Record<string, never> = {}
): MoneyGrantPort {
  const live = new Map<string, StoredGrant>();
  return {
    mint: async ({ binding, expiresAt }) => {
      const token = newToken();
      if (live.has(token)) throw new Error("commerce: grant token source repeated a live token");
      live.set(token, { binding: { ...binding }, expiresAt });
      return token;
    },
    // No await between the check and the delete: the consume is atomic within the event loop.
    redeem: async ({ grant, binding }) => {
      const stored = live.get(grant);
      if (!stored || now() >= stored.expiresAt || !sameGrantBinding({ a: stored.binding, b: binding })) return false;
      live.delete(grant);
      return true;
    },
  };
}
