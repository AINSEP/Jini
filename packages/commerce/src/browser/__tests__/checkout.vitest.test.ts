import { JSDOM } from "jsdom";
import { expect, it, vi } from "vitest";
import { COMMERCE_CHECKOUT_SCRIPT, installCommerceCheckout } from "../checkout.js";

const orders = "/api/commerce/v1/workspaces/site/orders";
function page() {
  const dom = new JSDOM(`<form data-commerce-checkout data-orders-url="${orders}" data-price-id="price"><button type="submit">Buy now</button><button type="button" data-checkout-new-order hidden>Start a new order</button><p data-checkout-status role="status"></p><a data-checkout-order hidden>View order</a></form>`, { url: "https://shop.test/products/book", runScripts: "outside-only" });
  return { dom, form: dom.window.document.querySelector("form")!, status: dom.window.document.querySelector("[data-checkout-status]")!, link: dom.window.document.querySelector("a")! };
}
function response(body: unknown, status = 200): Response { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }); }
async function submit(w: ReturnType<typeof page>) {
  w.form.dispatchEvent(new w.dom.window.Event("submit", { cancelable: true }));
  await vi.waitFor(() => expect(w.form.querySelector("button")!.disabled).toBe(false));
}
it("persists the pending order before pay, prevents duplicate clicks and navigates only the provider HTTPS next action", async () => {
  const w = page(), navigate = vi.fn(); let resolve!: (response: Response) => void;
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementationOnce(() => new Promise(done => { resolve = done; }))
    .mockImplementationOnce(async () => {
      expect(w.dom.window.sessionStorage.getItem(`commerce:${orders}:price`)).toBe("order-1");
      return response({ order: { id: "order-1", status: "pending" }, payment: { next: { kind: "redirect", url: "https://checkout.provider.test/session" } } });
    });
  installCommerceCheckout({ document: w.dom.window.document, fetch, storage: w.dom.window.sessionStorage, navigate });
  w.form.dispatchEvent(new w.dom.window.Event("submit", { cancelable: true }));
  w.form.dispatchEvent(new w.dom.window.Event("submit", { cancelable: true }));
  expect(fetch).toHaveBeenCalledTimes(1);
  resolve(response({ order: { id: "order-1" } }, 201));
  await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith({ url: "https://checkout.provider.test/session" }));
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([orders, `${orders}/order-1/pay`]);
  expect(w.link.href).toBe(`https://shop.test${orders}/order-1`);
});
it("after a lost pay response and browser reload, retries the same saved order without another create", async () => {
  const first = page(); const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(response({ order: { id: "order-1" } }, 201)).mockRejectedValueOnce(new Error("lost response"));
  installCommerceCheckout({ document: first.dom.window.document, fetch, storage: first.dom.window.sessionStorage, navigate: vi.fn() });
  await submit(first);
  expect(first.status.textContent).toContain("order-1");
  expect(first.form.querySelector<HTMLButtonElement>("[data-checkout-new-order]")!.hidden).toBe(true);
  const reloaded = page(); const retry = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response({ order: { id: "order-1", status: "pending" }, payment: { next: null } }));
  installCommerceCheckout({ document: reloaded.dom.window.document, fetch: retry, storage: first.dom.window.sessionStorage, navigate: vi.fn() });
  await submit(reloaded);
  expect(retry).toHaveBeenCalledTimes(1); expect(retry.mock.calls[0]![0]).toBe(`${orders}/order-1/pay`);
  expect(reloaded.status.textContent).toContain("still updating");
});
it.each(["http://checkout.provider.test/session", "javascript:alert(1)", "https://user:secret@checkout.test/session"])("refuses unsafe provider navigation %s and retains the order", async url => {
  const w = page(), navigate = vi.fn();
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(response({ order: { id: "order-1" } })).mockResolvedValueOnce(response({ order: { id: "order-1", status: "pending" }, payment: { next: { kind: "redirect", url } } }));
  installCommerceCheckout({ document: w.dom.window.document, fetch, storage: w.dom.window.sessionStorage, navigate }); await submit(w);
  expect(navigate).not.toHaveBeenCalled(); expect(w.status.textContent).toContain("secure checkout link");
  expect(w.dom.window.sessionStorage.getItem(`commerce:${orders}:price`)).toBe("order-1");
});
it("shows a specific authentication error without submitting payment or exposing HTML", async () => {
  const w = page(), fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response({ error: "Sign in as a shop member <script>secret</script>" }, 401));
  installCommerceCheckout({ document: w.dom.window.document, fetch, storage: w.dom.window.sessionStorage, navigate: vi.fn() }); await submit(w);
  expect(fetch).toHaveBeenCalledTimes(1); expect(w.status.textContent).toContain("Sign in as a shop member"); expect(w.status.querySelector("script")).toBeNull();
});

it("the exact external script binds and performs checkout without module imports or inline host code", async () => {
  const w = page();
  w.dom.window.fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(response({ order: { id: "order-script" } })).mockResolvedValueOnce(response({ order: { id: "order-script", status: "pending" }, payment: { next: null } }));
  w.dom.window.eval(COMMERCE_CHECKOUT_SCRIPT);
  await submit(w);
  expect(w.dom.window.fetch).toHaveBeenCalledTimes(2);
  expect(w.status.textContent).toContain("order-script");
});
it("provider completion alone does not mark an order paid; authoritative paid order permits an explicit new purchase", async () => {
  const w = page(), navigate = vi.fn();
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(response({ order: { id: "order-1" } })).mockResolvedValueOnce(response({ order: { id: "order-1", status: "pending" }, payment: { status: "succeeded", next: null } })).mockResolvedValueOnce(response({ order: { id: "order-1", status: "paid" }, payment: { next: { kind: "redirect", url: "https://checkout.test/stale" } } }));
  installCommerceCheckout({ document: w.dom.window.document, fetch, storage: w.dom.window.sessionStorage, navigate });
  await submit(w); expect(w.status.textContent).toContain("still updating");
  await submit(w); expect(w.status.textContent).toContain("confirmed that this order is paid");
  expect(navigate).not.toHaveBeenCalled(); expect(w.form.querySelector("button")!.textContent).toBe("Buy again");
  expect(w.dom.window.sessionStorage.getItem(`commerce:${orders}:price`)).toBeNull();
});
it("does not send money when the pending order could not be persisted", async () => {
  const w = page(), fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response({ order: { id: "order-1" } }));
  installCommerceCheckout({ document: w.dom.window.document, fetch, storage: { getItem: () => null, setItem: () => { throw new Error("storage unavailable"); }, removeItem: vi.fn() }, navigate: vi.fn() });
  await submit(w); expect(fetch).toHaveBeenCalledTimes(1); expect(w.status.textContent).toContain("Payment has not been requested"); expect(w.status.textContent).toContain("order-1");
});
it("repeated asset initialization does not attach another money submission handler", async () => {
  const w = page();
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(response({ order: { id: "order-1" } })).mockResolvedValue(response({ order: { id: "order-1", status: "pending" }, payment: { next: null } }));
  const ports = { document: w.dom.window.document, fetch, storage: w.dom.window.sessionStorage, navigate: vi.fn() };
  installCommerceCheckout(ports); installCommerceCheckout(ports);
  await submit(w);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("a changed member can explicitly start a new order after owned-order404 without exposing the previous order", async () => {
  const w = page(); w.dom.window.sessionStorage.setItem(`commerce:${orders}:price`, "previous-member-order");
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(response({ code: "COMMERCE_NOT_FOUND", error: "Unavailable for this account." }, 404)).mockResolvedValueOnce(response({ order: { id: "new-member-order" } }, 201)).mockResolvedValueOnce(response({ order: { id: "new-member-order", status: "pending" }, payment: { next: null } }));
  installCommerceCheckout({ document: w.dom.window.document, fetch, storage: w.dom.window.sessionStorage, navigate: vi.fn() });
  await submit(w);
  const recovery = w.form.querySelector<HTMLButtonElement>("[data-checkout-new-order]")!;
  expect(recovery.hidden).toBe(false); expect(fetch).toHaveBeenCalledTimes(1);
  expect(w.status.textContent).toContain("original account"); expect(w.status.textContent).not.toContain("previous-member-order");
  expect(w.dom.window.sessionStorage.getItem(`commerce:${orders}:price`)).toBe("previous-member-order");
  recovery.click(); await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([`${orders}/previous-member-order/pay`, orders, `${orders}/new-member-order/pay`]);
  expect(w.dom.window.sessionStorage.getItem(`commerce:${orders}:price`)).toBe("new-member-order");
});
it.each([500, 503])("an HTTP%i response cannot offer a fresh payment or clear the saved order", async status => {
  const w = page(); w.dom.window.sessionStorage.setItem(`commerce:${orders}:price`, "order-1");
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response({ code: "COMMERCE_NOT_FOUND", error: "Temporary service interruption." }, status));
  installCommerceCheckout({ document: w.dom.window.document, fetch, storage: w.dom.window.sessionStorage, navigate: vi.fn() }); await submit(w);
  const recovery = w.form.querySelector<HTMLButtonElement>("[data-checkout-new-order]")!;
  expect(recovery.hidden).toBe(true); recovery.click(); expect(fetch).toHaveBeenCalledTimes(1);
  expect(w.dom.window.sessionStorage.getItem(`commerce:${orders}:price`)).toBe("order-1");
});
it.each(["failed", "canceled"])("a definitive %s payment shows its intent error and permits only an explicit new order", async status => {
  const w = page();
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(response({ order: { id: "order-1" } })).mockResolvedValueOnce(response({ order: { id: "order-1", status: "pending" }, payment: { status, next: null }, intent: { ok: false, error: { code: "DECLINED", message: "Your card was declined <script>unsafe</script>." } } })).mockResolvedValueOnce(response({ order: { id: "order-2" } })).mockResolvedValueOnce(response({ order: { id: "order-2", status: "pending" }, payment: { next: null } }));
  installCommerceCheckout({ document: w.dom.window.document, fetch, storage: w.dom.window.sessionStorage, navigate: vi.fn() }); await submit(w);
  expect(w.status.textContent).toContain("Your card was declined"); expect(w.status.querySelector("script")).toBeNull();
  expect(w.form.querySelector<HTMLButtonElement>("[data-checkout-new-order]")!.hidden).toBe(false);
  expect(w.dom.window.sessionStorage.getItem(`commerce:${orders}:price`)).toBe("order-1");
  expect(fetch).toHaveBeenCalledTimes(2);
  w.form.querySelector<HTMLButtonElement>("[data-checkout-new-order]")!.click();
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
  expect(fetch.mock.calls[2]![0]).toBe(orders);
  expect(fetch.mock.calls[3]![0]).toBe(`${orders}/order-2/pay`);
});
it("a missing-provider-configuration intent error is specific and retains the same pending order", async () => {
  const w = page();
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(response({ order: { id: "order-1" } })).mockResolvedValueOnce(response({ order: { id: "order-1", status: "pending" }, payment: null, intent: { ok: false, error: { code: "NO_CREDENTIALS_CONFIGURED", message: "The shop's payment credentials are not configured." } } }));
  installCommerceCheckout({ document: w.dom.window.document, fetch, storage: w.dom.window.sessionStorage, navigate: vi.fn() }); await submit(w);
  expect(w.status.textContent).toContain("payment credentials are not configured");
  expect(w.form.querySelector<HTMLButtonElement>("[data-checkout-new-order]")!.hidden).toBe(true);
  expect(w.dom.window.sessionStorage.getItem(`commerce:${orders}:price`)).toBe("order-1");
});

it("new recovery behavior also works with previously cached host markup", async () => {
  const w = page(); w.form.querySelector("[data-checkout-new-order]")!.remove();
  w.dom.window.sessionStorage.setItem(`commerce:${orders}:price`, "previous-order");
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response({ code: "COMMERCE_NOT_FOUND" }, 404));
  installCommerceCheckout({ document: w.dom.window.document, fetch, storage: w.dom.window.sessionStorage, navigate: vi.fn() }); await submit(w);
  const recovery = w.form.querySelector<HTMLButtonElement>("[data-checkout-new-order]")!;
  expect(recovery).not.toBeNull(); expect(recovery.hidden).toBe(false); expect(recovery.textContent).toBe("Start a new order");
});

it("an unavailable retry removes an earlier fresh-order offer and keeps the original order", async () => {
  const w = page();
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(response({ order: { id: "order-1" } })).mockResolvedValueOnce(response({ order: { id: "order-1", status: "pending" }, payment: { status: "failed", next: null } })).mockResolvedValueOnce(response({ error: "Temporary shop interruption." }, 503));
  installCommerceCheckout({ document: w.dom.window.document, fetch, storage: w.dom.window.sessionStorage, navigate: vi.fn() });
  await submit(w); expect(w.form.querySelector<HTMLButtonElement>("[data-checkout-new-order]")!.hidden).toBe(false);
  await submit(w); expect(w.form.querySelector<HTMLButtonElement>("[data-checkout-new-order]")!.hidden).toBe(true);
  w.form.querySelector<HTMLButtonElement>("[data-checkout-new-order]")!.click(); expect(fetch).toHaveBeenCalledTimes(3);
  expect(w.dom.window.sessionStorage.getItem(`commerce:${orders}:price`)).toBe("order-1");
});
