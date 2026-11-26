import { expect, it } from "vitest";
import { projectMediaProviderCatalog, type MediaProviderCatalogSource } from "../catalog-projection.js";

it("collapses duplicate aliases and omits credential-bearing default URLs", () => {
  const registry = { providers: { list: () => [
    { provider: { provider: { id: "legacy", label: "Provider", defaultBaseUrl: "https://example.test?token=secret" }, models: [{ id: "model" }, { id: "model" }] } },
    { provider: { provider: { id: "canonical", label: "Duplicate" }, models: [] } },
  ] } } as unknown as MediaProviderCatalogSource;
  expect(projectMediaProviderCatalog({ registry, aliases: { legacy: "canonical" } })).toEqual([{ id: "canonical", label: "Provider", models: ["model"] }]);
});
