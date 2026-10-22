/**
 * Closes the verified-origin decisions the sibling suites never reach: userinfo/empty-host/port-0
 * candidates, the HTTP default port on a dev-capability canonical origin, a site-scoped lookup,
 * and an operator URL whose host is only a DNS dot.
 */
import { describe, expect, it } from "vitest";
import {
  InMemoryOriginSettingRepo, OriginRegistry, isSameOrigin, normalizeOriginCandidate, resolveConfiguredOrigin,
} from "../verified-origin.js";
import type { OriginSettingRepoPort } from "../verified-origin/ports.js";
import type { VerifiedOrigin } from "../verified-origin/types.js";

const NOW = "2026-10-04T00:00:00.000Z";

describe("normalizeOriginCandidate refusals", () => {
  it("refuses a username or a password in the authority", () => {
    expect(normalizeOriginCandidate({ rawUrl: "https://user@good.com/" })).toBeNull();
    expect(normalizeOriginCandidate({ rawUrl: "https://:secret@good.com/" })).toBeNull();
  });

  it("refuses a host that is only the trailing DNS dot", () => {
    expect(normalizeOriginCandidate({ rawUrl: "https://./" })).toBeNull();
  });

  it("refuses an explicit port 0 but normalizes an explicit default port to the same value as none", () => {
    expect(normalizeOriginCandidate({ rawUrl: "https://good.com:0/" })).toBeNull();
    expect(normalizeOriginCandidate({ rawUrl: "http://Good.com.:80/x" })).toEqual({ scheme: "http", host: "good.com", port: 80 });
    expect(normalizeOriginCandidate({ rawUrl: "https://good.com:8443" })).toEqual({ scheme: "https", host: "good.com", port: 8443 });
  });
});

describe("isSameOrigin effective ports", () => {
  const dev: VerifiedOrigin = { scheme: "http", host: "localhost", verifiedAt: NOW, source: "dev-capability" };
  it("treats a portless HTTP canonical origin as port 80", () => {
    expect(isSameOrigin({ target: { scheme: "http", host: "localhost", port: 80 }, canonical: dev })).toBe(true);
    expect(isSameOrigin({ target: { scheme: "http", host: "localhost", port: 443 }, canonical: dev })).toBe(false);
  });
  it("compares an explicit canonical port exactly", () => {
    expect(isSameOrigin({ target: { scheme: "http", host: "localhost", port: 3000 }, canonical: { ...dev, port: 3000 } })).toBe(true);
    expect(isSameOrigin({ target: { scheme: "http", host: "localhost", port: 80 }, canonical: { ...dev, port: 3000 } })).toBe(false);
  });
});

describe("OriginRegistry site-scoped lookups", () => {
  it("passes siteId through to the canonical-origin lookup when the context carries one", async () => {
    const seen: unknown[] = [];
    const inner = new InMemoryOriginSettingRepo({ seeds: [{ workspaceId: "w1", origin: { scheme: "https", host: "good.com", verifiedAt: NOW, source: "workspace-setting" } }] });
    const registry = new OriginRegistry({ repo: inner });
    const original = registry.canonicalOrigin.bind(registry);
    registry.canonicalOrigin = async (ctx) => { seen.push(ctx); return original(ctx); };
    expect(await registry.isAllowedRedirectTarget({ context: { workspaceId: "w1", siteId: "s1" }, url: "https://good.com/a" })).toBe(true);
    expect(await registry.isAllowedEgressTarget({ context: { workspaceId: "w1" }, url: "https://good.com/a" })).toBe(true);
    expect(seen).toEqual([{ workspaceId: "w1", siteId: "s1" }, { workspaceId: "w1" }]);
  });

  it("fails closed when the allowlist read throws", async () => {
    const repo: OriginSettingRepoPort = {
      findByWorkspaceId: async () => ({ scheme: "https", host: "good.com", verifiedAt: NOW, source: "workspace-setting" }),
      findRedirectAllowlist: async () => { throw new Error("db down"); },
      findEgressAllowlist: async () => ["other.com"],
    };
    const registry = new OriginRegistry({ repo });
    expect(await registry.isAllowedRedirectTarget({ context: { workspaceId: "w1" }, url: "https://other.com/" })).toBe(false);
    expect(await registry.isAllowedEgressTarget({ context: { workspaceId: "w1" }, url: "https://other.com/" })).toBe(true);
  });
});

describe("resolveConfiguredOrigin", () => {
  it("refuses an operator URL whose host is only a DNS dot, with one warning naming the reason", () => {
    const warnings: string[] = [];
    const origin = resolveConfiguredOrigin({ env: { APP_PUBLIC_URL: "https://./" }, envVarName: "APP_PUBLIC_URL", clock: { nowIso: () => NOW }, warn: (m) => warnings.push(m) });
    expect(origin).toBeUndefined();
    expect(warnings).toEqual([
      "APP_PUBLIC_URL is set but was refused as this deployment's public origin (its host is empty); no origin was registered from it. Value: https://./",
    ]);
  });
});
