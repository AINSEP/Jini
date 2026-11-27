import { expect, it } from "vitest";
import { projectMediaProviderCatalog, type MediaProviderCatalogSource } from "../catalog-projection.js";

it("collapses duplicate aliases and omits credential-bearing default URLs", () => {
  const registry = { providers: { list: () => [
    { provider: { provider: { id: "legacy", label: "Provider", defaultBaseUrl: "https://example.test?token=secret" }, models: [{ id: "model" }, { id: "model" }] } },
    { provider: { provider: { id: "canonical", label: "Duplicate" }, models: [] } },
  ] } } as unknown as MediaProviderCatalogSource;
  expect(projectMediaProviderCatalog({ registry, aliases: { legacy: "canonical" } })).toEqual([{ id: "canonical", label: "Provider", models: ["model"] }]);
});

it("keeps a clean base URL, drops unparseable, credentialed or non-string ones, and skips hidden and stub providers", () => {
  const entry = (id: string, extra: Record<string, unknown>) => ({ provider: { provider: { id, label: `L-${id}`, ...extra }, models: [] } });
  const registry = { providers: { list: () => [
    entry("clean", { defaultBaseUrl: "https://api.example.test/v1" }),
    entry("unparseable", { defaultBaseUrl: "not a url" }),
    entry("userinfo", { defaultBaseUrl: "https://user:pw@api.example.test/" }),
    entry("fragment", { defaultBaseUrl: "https://api.example.test/#k" }),
    entry("empty", { defaultBaseUrl: "" }),
    entry("numeric", { defaultBaseUrl: 42 }),
    entry("hidden", { settingsVisible: false, defaultBaseUrl: "https://hidden.example.test/" }),
    entry("stub", {}),
  ] } } as unknown as MediaProviderCatalogSource;
  expect(projectMediaProviderCatalog({ registry, aliases: {} })).toEqual([
    { id: "clean", label: "L-clean", defaultBaseUrl: "https://api.example.test/v1" },
    { id: "unparseable", label: "L-unparseable" },
    { id: "userinfo", label: "L-userinfo" },
    { id: "fragment", label: "L-fragment" },
    { id: "empty", label: "L-empty" },
    { id: "numeric", label: "L-numeric" },
  ]);
});
