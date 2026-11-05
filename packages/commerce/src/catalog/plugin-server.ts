import { checkout, type CheckoutDeps, type CheckoutResult } from "./checkout.js";
import { CommerceCheckoutValidationError, CommerceOrderNotFoundError } from "./errors.js";
import { payOrder, type PayOrderDeps, type PayOrderResult } from "./pay-order.js";
import type { CommerceOrderRecord } from "./types.js";
import type { PaymentView } from "../payments/contract/payments-port.js";
import { scopeProblem, type PaymentScope } from "../payments/contract/scope.js";

export interface CommerceServerRequired {
  readonly scope: PaymentScope;
  readonly publicOrigin: string;
  readonly isActive: () => boolean | Promise<boolean>;
  /** Host-owned catalog DDL and payments ledger migrations, using the host migration runner. */
  readonly ensureSchema: () => Promise<void>;
  readonly checkoutDeps: CheckoutDeps;
  readonly payOrderDeps: PayOrderDeps | ((required: { orderId: string }) => PayOrderDeps | Promise<PayOrderDeps>);
  readonly warn: (message: string) => void;
}
export interface CommerceServerStatus {
  readonly active: boolean;
  readonly ready: boolean;
  readonly reason: string | null;
  readonly scope: PaymentScope;
}
export interface CommerceOrderView {
  readonly order: CommerceOrderRecord;
  readonly payment: PaymentView | null;
  readonly intent: PayOrderResult | null;
}
export interface CommerceServer {
  activate(required?: Record<string, never>, optional?: Record<string, never>): Promise<CommerceServerStatus>;
  status(required?: Record<string, never>, optional?: Record<string, never>): Promise<CommerceServerStatus>;
  createOrder(required: { memberId: string; priceId: string; quantity?: number }, optional?: Record<string, never>): Promise<CheckoutResult>;
  pay(required: { memberId: string; orderId: string }, optional?: Record<string, never>): Promise<CommerceOrderView>;
  readOrder(required: { memberId: string; orderId: string }, optional?: Record<string, never>): Promise<CommerceOrderView>;
}

/** Expected activation failures are recoverable checkout errors; they never refuse CMS boot. */
export class CommerceUnavailableError extends Error {
  readonly code = "COMMERCE_UNAVAILABLE";
  readonly status = 503;
}

/** Credentials, browser URL parameters and request bodies cannot select a merchant scope. */
function configurationProblem({ scope, publicOrigin }: Pick<CommerceServerRequired, "scope" | "publicOrigin">): string | null {
  const problem = scopeProblem({ scope });
  if (problem) return `Commerce merchant configuration is incomplete: ${problem}.`;
  try {
    const url = new URL(publicOrigin);
    if (url.protocol === "https:" && url.origin === publicOrigin && !url.username && !url.password) return null;
  } catch { /* An invalid URL has the same recoverable configuration outcome. */ }
  return "Commerce requires the deployed site's HTTPS origin before checkout can accept payments.";
}

/**
 * Compose the dormant commerce plugin over existing order and payments services.
 * Member ids must come from the host's authenticated session; this boundary checks ownership.
 * Activation serializes host migrations and warns on failure. Only payments evidence settles orders.
 * @complexity O(1) point reads/writes per request; no timers, polling or provider registry is added.
 */
export function createCommerceServer(required: CommerceServerRequired, _optional: Record<string, never> = {}): CommerceServer {
  const scope = Object.freeze({ ...required.scope });
  const configuration = configurationProblem({ scope, publicOrigin: required.publicOrigin });
  let prepared = false;
  let preparing: Promise<void> | null = null;
  let reason: string | null = "Commerce has not been activated.";
  const depsForOrder = async (orderId: string): Promise<PayOrderDeps> => typeof required.payOrderDeps === "function"
    ? required.payOrderDeps({ orderId }) : required.payOrderDeps;
  const status = async (): Promise<CommerceServerStatus> => {
    const active = await required.isActive();
    return { active, ready: active && prepared && configuration === null,
      reason: active ? reason : "Commerce is disabled. Existing payment settlement continues separately.", scope };
  };
  const activate = async (): Promise<CommerceServerStatus> => {
    if (!await required.isActive()) return status();
    if (configuration) { reason = configuration; required.warn(reason); return status(); }
    try {
      if (!prepared) {
        preparing ??= required.ensureSchema();
        await preparing;
        prepared = true;
      }
      reason = null;
    } catch {
      reason = "Commerce storage could not be prepared. Checkout is temporarily unavailable.";
      required.warn(reason);
    } finally { preparing = null; }
    return status();
  };
  const requireReady = async (): Promise<void> => {
    const current = await activate();
    if (!current.ready) throw new CommerceUnavailableError(current.reason ?? "Commerce checkout is temporarily unavailable.");
  };
  const ownedOrder = async ({ memberId, orderId }: { memberId: string; orderId: string }): Promise<CommerceOrderRecord> => {
    const order = await required.checkoutDeps.orders.findById({ workspaceId: scope.workspaceId, id: orderId });
    if (!memberId || !order || order.workspaceId !== scope.workspaceId || order.memberId !== memberId || order.id !== orderId) {
      throw new CommerceOrderNotFoundError("Order was not found for this signed-in member.");
    }
    return order;
  };
  const readOrder = async (input: { memberId: string; orderId: string }): Promise<CommerceOrderView> => {
    const order = await ownedOrder(input);
    const deps = await depsForOrder(order.id);
    const association = await deps.orderPayments.findByOrder({ workspaceId: scope.workspaceId, orderId: order.id });
    const payment = association?.paymentId
      ? await deps.payments.getPayment({ scope, paymentId: association.paymentId }) : null;
    return { order, payment, intent: null };
  };
  return {
    activate, status, readOrder,
    createOrder: async input => {
      await requireReady();
      if (!input.memberId) throw new CommerceCheckoutValidationError({ message: "Sign in before creating an order." });
      const price = await required.checkoutDeps.prices.findById({ workspaceId: scope.workspaceId, id: input.priceId });
      if (price?.billingInterval !== undefined) throw new CommerceCheckoutValidationError({ message: "Checkout supports one-time prices only." });
      return checkout({ deps: required.checkoutDeps, input: { ...input, workspaceId: scope.workspaceId, provider: scope.providerId } });
    },
    pay: async input => {
      await requireReady();
      const order = await ownedOrder(input);
      if (order.status === "paid") return readOrder(input);
      // Recheck activation after ownership I/O and immediately before any money operation.
      if (!await required.isActive()) throw new CommerceUnavailableError("Commerce is disabled. This order has not been charged.");
      const intent = await payOrder({ deps: await depsForOrder(order.id), input: { workspaceId: scope.workspaceId, orderId: order.id, scope } });
      return { ...await readOrder(input), intent };
    },
  };
}
