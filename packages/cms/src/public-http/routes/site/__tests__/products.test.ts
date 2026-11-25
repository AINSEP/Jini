import { expect, it, vi } from "vitest";
import { storefrontProductRoute, resolveStorefrontProduct } from "../products.js";

it("missing detail performs no theme or checkout work and uses a point lookup", async () => {
  const find = vi.fn(async () => null);
  const renderPage = vi.fn(async () => "page");
  const decorateCheckout = vi.fn(async () => "checkout");
  const deps = { findProduct: ({ id }: { id: string }) => resolveStorefrontProduct({ id, find }), renderPage, decorateCheckout };
  expect(await storefrontProductRoute.handle({ raw: { params: { id: "beyond-grid" } }, deps })).toEqual({ kind: "missing" });
  expect(find).toHaveBeenCalledWith({ idOrSlug: "beyond-grid" }, {});
  expect(renderPage).not.toHaveBeenCalled();
  expect(decorateCheckout).not.toHaveBeenCalled();
});
