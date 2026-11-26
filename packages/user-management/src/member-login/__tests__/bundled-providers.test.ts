import { parseLoginProviders } from "../../server/login-providers.js";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { fingerprint, loadBundledLoginProviders, loadLoginProviders } from "../providers.js";
import type { LoginProviderPreset } from "../../server/login-types.js";

it("loads bundled descriptors before installed admission and fingerprints the descriptor", async () => {
  const order: string[] = [];
  const descriptor = { id: "oidc", label: "OIDC", issuer: "https://issuer.example", authorizationEndpoint: "https://issuer.example/auth", tokenEndpoint: "https://issuer.example/token",
    jwksUri: "https://issuer.example/jwks", scopes: ["openid"], signingAlgorithm: "RS256", clientAuthentication: "client_secret_post", credentialLabel: "OIDC", credentialCardTarget: "oidc", pkce: "S256" } as LoginProviderPreset;
  const sha256Hex = ({ text }: { text: string }) => createHash("sha256").update(text).digest("hex");
  const bundledProviders = await loadBundledLoginProviders({ parseLoginProviders, sourceRoot: "/bundle", sha256Hex,
    bundledContributionSources: () => [{ pluginId: "bundled", packageRoot: "/bundle/plugin" }],
    readManifest: async () => { order.push("manifest"); return { unrelated: "manifest" }; }, acceptsManifest: () => true,
    loadPluginContributionsFromSource: async ({ plugin, definition }) => {
      order.push("descriptor");
      return { items: [await definition.load({ descriptor, plugin })] };
    } });
  expect(bundledProviders[0]?.configurationVersion).toBe(sha256Hex({ text: JSON.stringify(descriptor) }));
  const result = await loadLoginProviders({ workspaceId: "site", bundledProviders, loadCandidates: async () => { order.push("installed"); return bundledProviders; } });
  expect(result).toEqual(bundledProviders);
  expect(order).toEqual(["manifest", "descriptor", "installed"]);
  expect(fingerprint({ value: { ...descriptor, tokenEndpoint: "https://changed.example/token" }, sha256Hex })).not.toBe(bundledProviders[0]?.configurationVersion);
});

it("an absent installed descriptor yields no admitted candidate", async () => {
  expect(await loadLoginProviders({ workspaceId: "site", bundledProviders: [], loadCandidates: async () => [] })).toEqual([]);
});
