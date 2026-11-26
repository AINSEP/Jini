import { defineJsonRoute, ok, routeReply, type RouteReply, type RateLimitResult } from '@jini-ai/core/contracts/server';
import { CommerceCheckoutValidationError, CommerceOrderNotFoundError, CommercePriceNotFoundError, CommerceProductNotFoundError } from '../catalog/errors.js';
import { commerceBuyerStatus, toCommerceBuyerOrder } from '../catalog/buyer-order.js';
import type { CommerceOrderView } from '../catalog/plugin-server.js';

const ORDERS = '/api/commerce/v1/workspaces/:workspaceId/orders';
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256;

/** Deny before effects on foreign scope, off/unavailable commerce, failed auth or rate budget. O(1) I/O. */
export async function admitPurchase(input: { workspaceId: string; requestedWorkspaceId: string | undefined } & (
  { mode: 'read'; deps: {
  markNoStore(required: Record<string, never>): void;
  resolveCommerce(required: { mode: 'read' | 'write' }): boolean;
  checkLimit(required: Record<string, never>): Promise<RateLimitResult>;
  setRetryAfter(required: { seconds: number }): void;
  buyer(required: Record<string, never>): Promise<string | null>;
} } | { mode: 'write'; deps: {
  markNoStore(required: Record<string, never>): void;
  resolveCommerce(required: { mode: 'read' | 'write' }): boolean;
  checkLimit(required: Record<string, never>): Promise<RateLimitResult>;
  setRetryAfter(required: { seconds: number }): void;
  buyer(required: Record<string, never>): Promise<string | null>;
  sameOrigin(required: Record<string, never>): boolean;
  checkoutOrigin(required: Record<string, never>): Promise<string | null>;
  requestOrigin(required: Record<string, never>): string;
  activate(required: Record<string, never>): Promise<{ ready: boolean; reason: string | null }>;
} }
), _optional = {}): Promise<{ ok: true; memberId: string } | { ok: false; reply: RouteReply }> {
  const { deps, workspaceId, requestedWorkspaceId } = input;
  deps.markNoStore({});
  if (requestedWorkspaceId && requestedWorkspaceId !== workspaceId) return { ok: false, reply: routeReply({ status: 404, body: { error: 'This shop was not found.', code: 'SHOP_NOT_FOUND' } }) };
  if (!deps.resolveCommerce({ mode: input.mode })) return { ok: false, reply: routeReply({ status: 503, body: { error: 'Checkout is not enabled for this shop.', code: 'COMMERCE_UNAVAILABLE' } }) };
  const limit = await deps.checkLimit({});
  if (!limit.allowed) {
    deps.setRetryAfter({ seconds: limit.retryAfterSeconds });
    return { ok: false, reply: routeReply({ status: 429, body: { error: 'Too many checkout requests. Please wait a minute and try again.', code: 'RATE_LIMIT_EXCEEDED' } }) };
  }
  const memberId = await deps.buyer({});
  if (!memberId) return { ok: false, reply: routeReply({ status: 401, body: { error: 'Sign in as a shop member to view or pay for your order.', code: 'MEMBER_SIGN_IN_REQUIRED' } }) };
  if (input.mode === 'write') {
    const refusal = await admitWrite({ deps: input.deps });
    if (refusal) return { ok: false, reply: refusal };
  }
  return { ok: true, memberId };
}

/** Only ready checkout accepts mutations, with the existing site origin policy. O(1). */
async function admitWrite({ deps }: { deps: Extract<Parameters<typeof admitPurchase>[0], { mode: 'write' }>['deps'] }): Promise<RouteReply | null> {
  if (!deps.sameOrigin({})) return routeReply({ status: 403, body: { error: 'Open this shop to complete your purchase.', code: 'SAME_ORIGIN_REQUIRED' } });
  const origin = await deps.checkoutOrigin({});
  if (!origin) return unavailable({});
  const requestOrigin = deps.requestOrigin({});
  if (requestOrigin !== origin) return routeReply({ status: 403, body: { error: 'Open the deployed shop to complete your purchase. The desktop app manages the catalog.', code: 'DEPLOYED_SHOP_REQUIRED', checkoutOrigin: origin } });
  const status = await deps.activate({});
  if (status.ready) return null;
  return unavailable({}, { reason: status.reason ?? undefined });
}

function unavailable(_required: Record<string, never>, { reason = 'Checkout is not enabled for this shop.' }: { reason?: string | undefined } = {}): RouteReply {
  return routeReply({ status: 503, body: { error: reason, code: 'COMMERCE_UNAVAILABLE' } });
}

/** Allow only catalog choice and bounded quantity; prices/account/mode/identity are server-owned. O(k) keys. */
function orderInput({ body }: { body: unknown }, _optional = {}): { priceId: string; quantity?: number } | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const value = body as Record<string, unknown>;
  if (!Object.keys(value).every(key => key === 'priceId' || key === 'quantity') || !identifier(value.priceId)) return null;
  if (value.quantity === undefined) return { priceId: value.priceId };
  if (!validQuantity(value.quantity)) return null;
  return { priceId: value.priceId, quantity: value.quantity };
}

function validQuantity(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 100;
}

function emptyObject({ value }: { value: unknown }, _optional = {}): boolean {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0;
}

/** Known domain refusals are actionable; infrastructure failures never expose exception text. O(1). */
function failure({ error }: { error: unknown }): RouteReply {
  if (error instanceof CommerceOrderNotFoundError || error instanceof CommercePriceNotFoundError || error instanceof CommerceProductNotFoundError) return routeReply({ status: 404, body: { error: 'This order or catalog item is unavailable for your account.', code: 'COMMERCE_NOT_FOUND' } });
  if (error instanceof CommerceCheckoutValidationError) return routeReply({ status: 400, body: { error: error.message, code: 'CHECKOUT_INVALID' } });
  if (error instanceof Error && 'code' in error && error.code === 'COMMERCE_UNAVAILABLE') return unavailable({}, { reason: error.message });
  return routeReply({ status: 503, body: { error: 'The shop could not check your order. Retry this same order shortly; its payment status may still be updating.', code: 'CHECKOUT_RETRY' } });
}

export const createOrderRoute = defineJsonRoute<{ workspaceId: string | undefined; body: unknown }, unknown, Extract<Parameters<typeof admitPurchase>[0], { mode: 'write' }>['deps'] & {
  workspaceId: string; createOrder(required: { memberId: string; priceId: string; quantity?: number }): Promise<unknown>;
}>({
  method: 'post', path: ORDERS,
  parse: raw => ok({ value: { workspaceId: raw.params.workspaceId, body: raw.body } }),
  handle: async ({ input, deps }) => {
    try {
      const parsed = orderInput({ body: input.body });
      if (!parsed) return ok({ value: routeReply({ status: 400, body: { error: 'Choose a price and a whole quantity from 1 to 100.', code: 'CHECKOUT_INVALID' } }) });
      const admitted = await admitPurchase({ workspaceId: deps.workspaceId, requestedWorkspaceId: input.workspaceId, mode: 'write', deps });
      if (!admitted.ok) return ok({ value: admitted.reply });
      return ok({ value: await deps.createOrder({ memberId: admitted.memberId, ...parsed }) });
    } catch (error) { return ok({ value: failure({ error }) }); }
  },
}, { successStatus: 201 });

export const payOrderRoute = defineJsonRoute<{ workspaceId: string | undefined; orderId: string | undefined; body: unknown }, unknown, Extract<Parameters<typeof admitPurchase>[0], { mode: 'write' }>['deps'] & {
  workspaceId: string; pay(required: { memberId: string; orderId: string }): Promise<CommerceOrderView>;
}>({
  method: 'post', path: `${ORDERS}/:orderId/pay`,
  parse: raw => ok({ value: { workspaceId: raw.params.workspaceId, orderId: raw.params.orderId, body: raw.body } }),
  handle: async ({ input, deps }) => {
    try {
      if (!identifier(input.orderId) || !emptyObject({ value: input.body })) return ok({ value: routeReply({ status: 400, body: { error: 'Pay an existing order with an empty request body.', code: 'CHECKOUT_INVALID' } }) });
      const admitted = await admitPurchase({ workspaceId: deps.workspaceId, requestedWorkspaceId: input.workspaceId, mode: 'write', deps });
      if (!admitted.ok) return ok({ value: admitted.reply });
      const view = await deps.pay({ memberId: admitted.memberId, orderId: input.orderId });
      const buyerView = toCommerceBuyerOrder({ view });
      return ok({ value: { ...buyerView, payment: buyerView.payment ? { ...buyerView.payment, ...(view.payment?.next === undefined ? {} : { next: view.payment.next }) } : null,
        intent: view.intent ? { ok: view.intent.ok, ...('error' in view.intent ? { error: view.intent.error } : {}) } : null } });
    } catch (error) { return ok({ value: failure({ error }) }); }
  },
});

export const readOrderRoute = defineJsonRoute<{ workspaceId: string | undefined; orderId: unknown }, unknown, Extract<Parameters<typeof admitPurchase>[0], { mode: 'read' }>['deps'] & {
  workspaceId: string; readOrder(required: { memberId: string; orderId: string }): Promise<CommerceOrderView>;
}>({
  method: 'get', path: `${ORDERS}/:orderId`,
  parse: raw => ok({ value: { workspaceId: raw.params.workspaceId, orderId: raw.params.orderId ?? raw.query.orderId } }),
  handle: async ({ input, deps }) => {
    try {
      if (!identifier(input.orderId)) return ok({ value: routeReply({ status: 400, body: { error: 'Open your saved order link to check its payment status.', code: 'ORDER_ID_REQUIRED' } }) });
      const admitted = await admitPurchase({ workspaceId: deps.workspaceId, requestedWorkspaceId: input.workspaceId, mode: 'read', deps });
      if (!admitted.ok) return ok({ value: admitted.reply });
      return ok({ value: toCommerceBuyerOrder({ view: await deps.readOrder({ memberId: admitted.memberId, orderId: input.orderId }) }) });
    } catch (error) { return ok({ value: failure({ error }) }); }
  },
});

async function page({ query, deps }: {
  query: Readonly<Record<string, unknown>>;
  deps: Extract<Parameters<typeof admitPurchase>[0], { mode: 'read' }>['deps'] & {
    workspaceId: string;
    readOrder(required: { memberId: string; orderId: string }): Promise<CommerceOrderView>;
    renderBuyerPage(required: { status: number; title: string; message: string; order?: { id: string; status: string } }): Promise<string>;
  };
}, _optional = {}): Promise<{ status: number; html: string }> {
  try {
    const orderId = query.orderId;
    if (!identifier(orderId)) return { status: 400, html: await deps.renderBuyerPage({ status: 400, title: 'Check your order', message: 'Open your saved order link to check its payment status.' }) };
    const admitted = await admitPurchase({ workspaceId: deps.workspaceId, requestedWorkspaceId: undefined, mode: 'read', deps });
    if (!admitted.ok) {
      const body = admitted.reply.body as { error: string };
      return { status: admitted.reply.status, html: await deps.renderBuyerPage({ status: admitted.reply.status, title: 'Check your order', message: body.error }) };
    }
    const view = toCommerceBuyerOrder({ view: await deps.readOrder({ memberId: admitted.memberId, orderId }) });
    return { status: 200, html: await deps.renderBuyerPage({ status: 200, ...commerceBuyerStatus({ view }), order: view.order }) };
  } catch (error) {
    const missing = error instanceof CommerceOrderNotFoundError;
    const status = missing ? 404 : 503;
    return { status, html: await deps.renderBuyerPage({ status, title: 'Check your order', message: missing ? 'This order is unavailable for your account.' : 'The shop could not check your order. Retry this same order shortly; its payment status may still be updating.' }) };
  }
}

export const commerceReturnRoute = { method: 'get' as const, path: '/commerce/return', handle: page };
export const commerceCancelRoute = { method: 'get' as const, path: '/commerce/cancel', handle: page };
