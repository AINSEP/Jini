/** Browser-only checkout behavior. Host HTML supplies the trusted workspace URL and catalog price. */
export interface CommerceCheckoutBrowserRequired {
  document: Document;
  fetch: typeof globalThis.fetch;
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  navigate: (required: { url: string }) => void;
}

interface CheckoutResponse { order?: { id?: unknown; status?: unknown }; payment?: { next?: unknown }; error?: unknown }

/**
 * Bind one-price forms without polling. A pending order is saved before payment; duplicate clicks
 * and uncertain payment retries retain its id. Only server ledger truth can confirm payment.
 * @complexity O(forms) setup, O(1) state and at most two HTTP requests per submitted form.
 */
export function installCommerceCheckout(required: CommerceCheckoutBrowserRequired, _optional: Record<string, never> = {}): void {
  required.document.querySelectorAll<HTMLFormElement>("form[data-commerce-checkout]").forEach(form => {
    // Asset deduplication belongs to the form too: repeated script tags cannot create two charges.
    if (form.dataset.commerceCheckoutBound === "true") return;
    form.dataset.commerceCheckoutBound = "true";
    const orders = form.dataset.ordersUrl!;
    const priceId = form.dataset.priceId!;
    const key = `commerce:${orders}:${priceId}`;
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    const status = form.querySelector<HTMLElement>("[data-checkout-status]")!;
    const link = form.querySelector<HTMLAnchorElement>("[data-checkout-order]")!;
    let orderId: string | null = null;
    let busy = false;
    class CheckoutResponseError extends Error {}

    function showOrder(): void {
      if (!orderId) return;
      link.href = `${orders}/${encodeURIComponent(orderId)}`;
      link.hidden = false;
      link.textContent = `View order ${orderId}`;
    }
    function restoreOrder(): void {
      try { orderId = required.storage.getItem(key); }
      catch { status.textContent = "Your browser could not restore checkout. Keep this page open while paying."; }
      showOrder();
      if (orderId) button.textContent = "Continue checkout";
    }
    async function post(path: string, body: object): Promise<CheckoutResponse> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);
      try {
        const response = await required.fetch(path, { method: "POST", headers: { "Content-Type": "application/json" },
          credentials: "same-origin", redirect: "error", body: JSON.stringify(body), signal: controller.signal });
        const payload = await response.json() as CheckoutResponse;
        if (!response.ok) throw new CheckoutResponseError(typeof payload.error === "string" ? payload.error : "The shop could not accept this checkout request. Please retry.");
        return payload;
      } finally { clearTimeout(timeout); }
    }
    function navigate(next: unknown): boolean {
      const action = next as { kind?: string; url?: string } | null;
      if (action?.kind !== "redirect") return false;
      let url: URL;
      try { url = new URL(action.url!); } catch { throw new CheckoutResponseError("The shop did not return a secure checkout link. Retry this same order."); }
      if (url.protocol !== "https:" || url.username || url.password) throw new CheckoutResponseError("The shop did not return a secure checkout link. Retry this same order.");
      required.navigate({ url: url.href });
      return true;
    }
    async function prepareOrder(): Promise<void> {
      if (!orderId) {
        const result = await post(orders, { priceId, quantity: 1 });
        if (typeof result.order?.id !== "string" || !result.order.id) throw new CheckoutResponseError("The shop did not return an order number. Payment has not been requested.");
        orderId = result.order.id;
      }
      showOrder();
      // Persist before sending money. A reload after a lost payment response must not create a new charge key.
      try { required.storage.setItem(key, orderId!); }
      catch { throw new CheckoutResponseError("Your browser could not save this order. Payment has not been requested; keep this page open and retry."); }
    }
    function finish(result: CheckoutResponse): void {
      if (result.order?.status === "paid") {
        status.textContent = "The shop confirmed that this order is paid.";
        try { required.storage.removeItem(key); orderId = null; button.textContent = "Buy again"; }
        catch { button.textContent = "Check paid order"; }
        return;
      }
      if (navigate(result.payment?.next)) return;
      status.textContent = `Order ${orderId}: payment status is still updating. Retry this same order or open its saved link.`;
    }
    async function buy(): Promise<void> {
      if (busy) return;
      busy = true; button.disabled = true;
      status.textContent = "Preparing secure checkout…";
      try {
        await prepareOrder();
        finish(await post(`${orders}/${encodeURIComponent(orderId!)}/pay`, {}));
      } catch (error) {
        const reason = error instanceof CheckoutResponseError ? error.message : "The checkout response was interrupted. Payment status may still be updating.";
        status.textContent = orderId ? `${reason} Order ${orderId}; retry this same order or open its saved link.` : `${reason} No payment has been requested.`;
      } finally { busy = false; button.disabled = false; if (orderId) button.textContent = "Retry same order"; }
    }
    restoreOrder();
    form.addEventListener("submit", event => { event.preventDefault(); void buy(); });
  });
}

/** External-script payload; no inline script or provider code is needed in host templates. */
export const COMMERCE_CHECKOUT_SCRIPT = `(${installCommerceCheckout.toString()})({document,fetch:window.fetch.bind(window),storage:window.sessionStorage,navigate:({url})=>window.location.assign(url)});`;
