/** Browser-only checkout behavior. Host HTML supplies the trusted workspace URL and catalog price. */
export interface CommerceCheckoutBrowserRequired {
  document: Document;
  fetch: typeof globalThis.fetch;
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  navigate: (required: { url: string }) => void;
}

interface CheckoutResponse { order?: { id?: unknown; status?: unknown }; payment?: { next?: unknown; status?: unknown } | null;
  intent?: { ok?: unknown; error?: { message?: unknown } }; error?: unknown; code?: unknown }

/**
 * Bind one-price forms without polling. A pending order is saved before payment; duplicate clicks
 * and uncertain payment retries retain its id. Only server ledger truth can confirm payment.
 * @complexity O(forms) setup, O(1) state and at most two HTTP requests per submitted form.
 */
export function installCommerceCheckout(required: CommerceCheckoutBrowserRequired, _optional: Record<string, never> = {}): void {
  required.document.querySelectorAll<HTMLFormElement>("form[data-commerce-checkout]").forEach(form => bindCommerceCheckout(required, form));
}

function bindCommerceCheckout(required: CommerceCheckoutBrowserRequired, form: HTMLFormElement): void {
  // Asset deduplication belongs to the form too: repeated script tags cannot create two charges.
  if (form.dataset.commerceCheckoutBound === "true") return;
  form.dataset.commerceCheckoutBound = "true";
  const state = createCheckoutState(required, form);
  restoreOrder(state);
  state.newOrder.addEventListener("click", () => startNewOrder(state));
  form.addEventListener("submit", event => { event.preventDefault(); void buy(state); });
}

function createCheckoutState(required: CommerceCheckoutBrowserRequired, form: HTMLFormElement) {
  const orders = form.dataset.ordersUrl!;
  const priceId = form.dataset.priceId!;
  const key = `commerce:${orders}:${priceId}`;
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const status = form.querySelector<HTMLElement>("[data-checkout-status]")!;
  const link = form.querySelector<HTMLAnchorElement>("[data-checkout-order]")!;
  const newOrder = form.querySelector<HTMLButtonElement>("[data-checkout-new-order]")!;
  const orderId: string | null = null;
  const busy = false;
  const newOrderAllowed = false;
  class CheckoutResponseError extends Error {
    readonly missingOwnedOrder: boolean;
    constructor(input: { message: string; missingOwnedOrder?: boolean }) {
      super(input.message); this.missingOwnedOrder = input.missingOwnedOrder === true;
    }
  }
  return { required, orders, priceId, key, button, status, link, newOrder, orderId: orderId as string | null,
    busy, newOrderAllowed, CheckoutResponseError };
}

type CheckoutState = ReturnType<typeof createCheckoutState>;

function showOrder(state: CheckoutState): void {
  const { link } = state;
  if (!state.orderId) return;
  link.href = `/commerce/return?orderId=${encodeURIComponent(state.orderId)}`;
  link.hidden = false;
  link.textContent = `View order ${state.orderId}`;
}
function restoreOrder(state: CheckoutState): void {
  const { required, key, status, button } = state;
  try { state.orderId = required.storage.getItem(key); }
  catch { status.textContent = "Your browser could not restore checkout. Keep this page open while paying."; }
  showOrder(state);
  if (state.orderId) button.textContent = "Continue checkout";
}
async function post(state: CheckoutState, path: string, body: object): Promise<CheckoutResponse> {
  const { required, CheckoutResponseError } = state;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await required.fetch(path, { method: "POST", headers: { "Content-Type": "application/json" },
      credentials: "same-origin", redirect: "error", body: JSON.stringify(body), signal: controller.signal });
    const payload = await response.json() as CheckoutResponse;
    if (!response.ok) throw new CheckoutResponseError({ message: typeof payload.error === "string" ? payload.error : "The shop could not accept this checkout request. Please retry.",
      missingOwnedOrder: response.status === 404 && payload.code === "COMMERCE_NOT_FOUND" });
    return payload;
  } finally { clearTimeout(timeout); }
}
function navigate(state: CheckoutState, next: unknown): boolean {
  const { required, CheckoutResponseError } = state;
  const action = next as { kind?: string; url?: string } | null;
  if (action?.kind !== "redirect") return false;
  let url: URL;
  try { url = new URL(action.url!); } catch { throw new CheckoutResponseError({ message: "The shop did not return a secure checkout link. Retry this same order." }); }
  if (url.protocol !== "https:" || url.username || url.password) throw new CheckoutResponseError({ message: "The shop did not return a secure checkout link. Retry this same order." });
  required.navigate({ url: url.href });
  return true;
}
async function prepareOrder(state: CheckoutState): Promise<void> {
  const { required, orders, priceId, key, CheckoutResponseError } = state;
  if (!state.orderId) {
    const result = await post(state, orders, { priceId, quantity: 1 });
    if (typeof result.order?.id !== "string" || !result.order.id) throw new CheckoutResponseError({ message: "The shop did not return an order number. Payment has not been requested." });
    state.orderId = result.order.id;
  }
  showOrder(state);
  // Persist before sending money. A reload after a lost payment response must not create a new charge key.
  try { required.storage.setItem(key, state.orderId!); }
  catch { throw new CheckoutResponseError({ message: "Your browser could not save this order. Payment has not been requested; keep this page open and retry." }); }
}
function offerNewOrder(state: CheckoutState, message: string): void {
  const { newOrder, status } = state;
  state.newOrderAllowed = true; newOrder.hidden = false; status.textContent = message;
}
function paymentRefusal(state: CheckoutState, result: CheckoutResponse): boolean {
  const { status } = state;
  const paymentStatus = result.payment?.status;
  const terminal = paymentStatus === "failed" || paymentStatus === "canceled";
  if (result.intent?.ok !== false && !terminal) return false;
  const message = typeof result.intent?.error?.message === "string" ? result.intent.error.message : "This payment was not completed.";
  if (terminal) offerNewOrder(state, `${message} Retry this order or choose Start a new order for a separate purchase.`);
  else status.textContent = `${message} Retry this same order after the shop is ready.`;
  return true;
}
function reportError(state: CheckoutState, error: unknown): void {
  const { CheckoutResponseError, link, status } = state;
  if (error instanceof CheckoutResponseError && error.missingOwnedOrder && state.orderId) {
    link.hidden = true;
    offerNewOrder(state, "This saved order is unavailable for the signed-in account. Sign in to the original account to retry it, or choose Start a new order for this account.");
    return;
  }
  const reason = error instanceof CheckoutResponseError ? error.message : "The checkout response was interrupted. Payment status may still be updating.";
  status.textContent = state.orderId ? `${reason} Order ${state.orderId}; retry this same order or open its saved link.` : `${reason} No payment has been requested.`;
}
function startNewOrder(state: CheckoutState): void {
  const { required, key, status, link, newOrder } = state;
  if (state.busy || !state.newOrderAllowed) return;
  try { required.storage.removeItem(key); }
  catch { status.textContent = "Your browser could not clear the saved order. Keep this page open and retry; a new payment has not been requested."; return; }
  state.orderId = null; link.hidden = true; state.newOrderAllowed = false; newOrder.hidden = true;
  void buy(state);
}
function finish(state: CheckoutState, result: CheckoutResponse): void {
  const { required, key, status, button } = state;
  if (result.order?.status === "paid") {
    status.textContent = "The shop confirmed that this order is paid.";
    try { required.storage.removeItem(key); state.orderId = null; button.textContent = "Buy again"; }
    catch { button.textContent = "Check paid order"; }
    return;
  }
  if (paymentRefusal(state, result)) return;
  if (navigate(state, result.payment?.next)) return;
  status.textContent = `Order ${state.orderId}: payment status is still updating. Retry this same order or open its saved link.`;
}
async function buy(state: CheckoutState): Promise<void> {
  const { orders, button, newOrder, status } = state;
  if (state.busy) return;
  state.busy = true; button.disabled = true; state.newOrderAllowed = false; newOrder.hidden = true;
  status.textContent = "Preparing secure checkout…";
  try {
    await prepareOrder(state);
    finish(state, await post(state, `${orders}/${encodeURIComponent(state.orderId!)}/pay`, {}));
  } catch (error) { reportError(state, error);
  } finally { state.busy = false; button.disabled = false; if (state.orderId) button.textContent = "Retry same order"; }
}

/** External-script payload; no inline script or provider code is needed in host templates. */
export const COMMERCE_CHECKOUT_SCRIPT = `(()=>{${[bindCommerceCheckout, createCheckoutState, showOrder, restoreOrder, post, navigate, prepareOrder,
  offerNewOrder, paymentRefusal, reportError, startNewOrder, finish, buy].map(helper => helper.toString()).join(";")};(${installCommerceCheckout.toString()})({document,fetch:window.fetch.bind(window),storage:window.sessionStorage,navigate:({url})=>window.location.assign(url)});})();`;
