import { expect, it, vi } from "vitest";
import { buildCommerceCatalogRegistrations, buildRegistrations, type CommerceCatalogToolsDeps } from "../../../tools.js";

const scope = { workspaceId: "ws", siteId: "site", providerId: "stripe", providerAccountId: "acct", mode: "test" as const };
const context = { executionId: "exec", principal: { id: "owner" }, run: { id: "run" }, signal: new AbortController().signal };
function fixture() {
  const product = { id: "product", workspaceId: "ws", name: "Notebook", slug: "notebook", kind: "one_time" as const, status: "active" as const, createdAt: "2026-11-05T00:00:00.000Z", updatedAt: "2026-11-05T00:00:00.000Z", version: 1 };
  const products = { findById: vi.fn(async () => product), findBySlug: vi.fn(), listActive: vi.fn(async () => []), save: vi.fn() };
  const prices = { findById: vi.fn(), listByProduct: vi.fn(), save: vi.fn() };
  const activate = vi.fn(async () => ({ active: true, ready: true, reason: null as string | null, scope }));
  const deps: CommerceCatalogToolsDeps = { workspaceId: "ws", authorize: vi.fn(async () => ({ allowed: true, reason: "matched" })),
    commerce: { activate }, products, prices, clock: { nowMs: () => Date.parse(product.createdAt) }, idGen: { newId: () => "new-id" } };
  const [createProduct, createPrice] = buildCommerceCatalogRegistrations(deps);
  return { deps, product, products, prices, activate, createProduct: (input: unknown) => createProduct!.handler({ ...context, input }),
    createPrice: (input: unknown) => createPrice!.handler({ ...context, input }) };
}
it("creates one scoped active product and a separate immutable one-time price, never a payment", async () => {
  const f = fixture();
  expect(await f.createProduct({ name: "Notebook", slug: "notebook" })).toMatchObject({ product: { id: "new-id", workspaceId: "ws", kind: "one_time", status: "active" } });
  expect(f.products.save).toHaveBeenCalledTimes(1); expect(f.prices.save).not.toHaveBeenCalled();
  expect(await f.createPrice({ productId: "product", amount: { minorUnits: 123, currency: "JPY" } })).toMatchObject({ price: { id: "new-id", workspaceId: "ws", productId: "product", unitAmount: { minorUnits: 123, currency: "JPY" } } });
  expect(f.prices.save.mock.calls[0]![0]).not.toHaveProperty("billingInterval");
});
it("checks authorization before activation or catalog I/O", async () => {
  const f = fixture(); f.deps.authorize = vi.fn(async () => ({ allowed: false, reason: "denied" }));
  await expect(f.createProduct({ name: "Notebook", slug: "notebook" })).rejects.toThrow("not authorized");
  expect(f.activate).not.toHaveBeenCalled(); expect(f.products.save).not.toHaveBeenCalled();
});
it("refuses setup while disabled and propagates a specific recoverable reason", async () => {
  const f = fixture(); f.activate.mockResolvedValue({ active: false, ready: false, reason: "Commerce is disabled.", scope });
  await expect(f.createProduct({ name: "Notebook", slug: "notebook" })).rejects.toThrow("Commerce is disabled.");
  expect(f.products.save).not.toHaveBeenCalled();
});
it.each([
  { name: "Notebook", slug: "../other" }, { name: " ", slug: "notebook" }, { name: "Notebook", slug: "notebook", workspaceId: "other" },
])("rejects unsafe product input before a write: %j", async input => {
  const f = fixture(); await expect(f.createProduct(input)).rejects.toThrow(); expect(f.products.save).not.toHaveBeenCalled();
});
it.each([
  { productId: "product", amount: { minorUnits: -1, currency: "USD" } },
  { productId: "product", amount: { minorUnits: 1.5, currency: "USD" } },
  { productId: "product", amount: { minorUnits: 10, currency: "USD" }, providerAccountId: "other" },
])("rejects invalid or foreign price input before a write: %j", async input => {
  const f = fixture(); await expect(f.createPrice(input)).rejects.toThrow(); expect(f.prices.save).not.toHaveBeenCalled();
});
it("refuses a foreign product returned by an adapter", async () => {
  const f = fixture(); f.product.workspaceId = "foreign";
  await expect(f.createPrice({ productId: "product", amount: { minorUnits: 123, currency: "JPY" } })).rejects.toThrow("not found in this workspace");
  expect(f.prices.save).not.toHaveBeenCalled();
});
it("status delegates to the current server after permission without reading any credentials", async () => {
  const status = vi.fn(async () => ({ active: false, ready: false, reason: "Commerce is disabled.", scope }));
  const [registration] = buildRegistrations({ workspaceId: "ws", authorize: async () => ({ allowed: true, reason: "matched" }), commerce: { status } });
  expect(await registration!.handler({ ...context, input: {} })).toMatchObject({ contractVersion: 1, workspaceId: "ws", checkout: { active: false, ready: false, reason: "Commerce is disabled." }, capabilities: { checkout: "unavailable" } });
  expect(status).toHaveBeenCalledTimes(1);
});
it("refuses setup when a host injects a server for another workspace", async () => {
  const f = fixture(); f.activate.mockResolvedValue({ active: true, ready: true, reason: null, scope: { ...scope, workspaceId: "foreign" } });
  await expect(f.createProduct({ name: "Notebook", slug: "notebook" })).rejects.toThrow("configured for another workspace");
  expect(f.products.save).not.toHaveBeenCalled();
});
it("preserves the status envelope and reports checkout only from operational readiness", async () => {
  const [registration] = buildRegistrations({ workspaceId: "ws", authorize: async () => ({ allowed: true, reason: "matched" }),
    commerce: { status: async () => ({ active: true, ready: true, reason: null, scope }) } });
  expect(await registration!.handler({ ...context, input: {} })).toMatchObject({ contractVersion: 1, workspaceId: "ws", providers: [],
    paymentRuntime: { status: "unavailable" }, configuration: { status: "unavailable" }, checkout: { active: true, ready: true, reason: null },
    capabilities: { checkout: "available", subscriptions: "unavailable", revenue: "unavailable" } });
});
it("reports the host's configured public webhook URL without reading provider secrets", async () => {
  const webhookUrl = "https://shop.example/api/payments/webhooks/site/stripe/test";
  const [registration] = buildRegistrations({ workspaceId: "ws", authorize: async () => ({ allowed: true, reason: "matched" }),
    commerce: { status: async () => ({ active: true, ready: true, reason: null, scope, webhookUrl }) } });
  expect(await registration!.handler({ ...context, input: {} })).toMatchObject({ checkout: { webhookUrl } });
});

it('warns after creating catalog records when more than 24 active products exist', async () => {
  const f = fixture();
  f.products.listActive.mockResolvedValue(Array.from({ length: 25 }, (_, i) => ({ ...f.product, id: `product-${i}` })) as never);
  const productResult = await f.createProduct({ name: 'Notebook', slug: 'notebook' });
  expect(productResult).toMatchObject({ warnings: [expect.stringContaining('24')] });
  const priceResult = await f.createPrice({ productId: 'product', amount: { minorUnits: 123, currency: 'JPY' } });
  expect(priceResult).toMatchObject({ warnings: [expect.stringContaining('24')] });
  expect(f.products.listActive).toHaveBeenCalledWith({ workspaceId: 'ws', limit: 25 });
});

it('reports a saved record honestly if the bounded storefront warning read is unavailable', async () => {
  const f = fixture(); f.products.listActive.mockRejectedValue(new Error('storage read unavailable'));
  expect(await f.createProduct({ name: 'Notebook', slug: 'notebook' }))
    .toMatchObject({ product: { id: 'new-id' }, warnings: [expect.stringContaining('saved')] });
  expect(f.products.save).toHaveBeenCalledTimes(1);
});
