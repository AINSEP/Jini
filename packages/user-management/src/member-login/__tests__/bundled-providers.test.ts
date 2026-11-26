import { parseLoginProviders } from "../../server/login-providers.js";
import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { fingerprint, loadBundledLoginProviders, loadLoginProviders } from "../providers.js";
import type { LoginProviderPreset } from "../../server/login-types.js";

it("loads bundled descriptors before installed admission and fingerprints the descriptor", async () => {
  const order: string[] = [];
  const descriptor = { id: "oidc", label: "OIDC", issuer: "https://issuer.example", authorizationEndpoint: "https://issuer.example/auth", tokenEndpoint: "https://issuer.example/token",
    jwksUri: "https://issuer.example/jwks", scopes: ["openid", "email", "profile"], signingAlgorithm: "RS256", clientAuthentication: "client_secret_post", credentialLabel: "OIDC", credentialCardTarget: "oidc", pkce: "S256" } as const;
  const expectedPreset: LoginProviderPreset = { id: "oidc", label: "OIDC", issuer: "https://issuer.example", authorizationEndpoint: "https://issuer.example/auth", tokenEndpoint: "https://issuer.example/token",
    jwksUri: "https://issuer.example/jwks", scopes: ["openid", "email", "profile"], signingAlgorithm: "RS256", clientAuthentication: "client_secret_post", pkce: "S256", credentialLabel: "OIDC",
    credentialCardTarget: "oidc", authoritativeEmailDomains: [] };
  const sha256Hex = ({ text }: { text: string }) => createHash("sha256").update(text).digest("hex");
  const loadPluginContributionsFromSource = vi.fn<Parameters<typeof loadBundledLoginProviders>[0]["loadPluginContributionsFromSource"]>(async ({ plugin, definition }) => {
    order.push("descriptor");
    const parsed = definition.parse({ raw: JSON.stringify({ schemaVersion: 1, providers: [descriptor] }) });
    if (!parsed.ok) throw new Error(parsed.reason);
    return { items: parsed.descriptors.map(descriptor => definition.load({ descriptor, plugin })) };
  });
  const bundledProviders = await loadBundledLoginProviders({ parseLoginProviders, sourceRoot: "/bundle", sha256Hex,
    bundledContributionSources: () => [{ pluginId: "bundled", packageRoot: "/bundle/plugin" }, { pluginId: "blocked", packageRoot: "/bundle/blocked" }],
    readManifest: async ({ plugin }) => { order.push("manifest"); return { id: plugin.pluginId }; },
    acceptsManifest: ({ manifest }) => (manifest as { id: string }).id === "bundled",
    loadPluginContributionsFromSource });
  expect(loadPluginContributionsFromSource.mock.calls.map(([{ plugin }]) => plugin)).toEqual([{ pluginId: "bundled", packageRoot: "/bundle/plugin" }]);
  expect(bundledProviders).toEqual([{ ...expectedPreset, pluginId: "bundled", configurationVersion: sha256Hex({ text: JSON.stringify(expectedPreset) }) }]);
  const result = await loadLoginProviders({ workspaceId: "site", bundledProviders, loadCandidates: async () => { order.push("installed"); return bundledProviders; } });
  expect(result).toEqual(bundledProviders);
  expect(order).toEqual(["manifest", "descriptor", "manifest", "installed"]);
  expect(fingerprint({ value: { ...expectedPreset, tokenEndpoint: "https://changed.example/token" }, sha256Hex })).not.toBe(bundledProviders[0]?.configurationVersion);
});

it("an absent installed descriptor yields no admitted candidate", async () => {
  expect(await loadLoginProviders({ workspaceId: "site", bundledProviders: [], loadCandidates: async () => [] })).toEqual([]);
});
