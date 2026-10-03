import assert from "node:assert/strict";
import { test } from "vitest";

import { OriginRegistry } from "../verified-origin.js";
import { InMemoryOriginSettingRepo } from "../verified-origin.js";
import { OriginNotVerifiedError, createVerifiedOrigin, InsecureOriginSourceError } from "../verified-origin.js";

const WORKSPACE = "workspace-1";

function makeRegistry(options?: {
  redirectAllowlist?: string[];
  egressAllowlist?: string[];
}) {
  const repo = new InMemoryOriginSettingRepo({ seeds: [
    {
      workspaceId: WORKSPACE,
      origin: {
        scheme: "https",
        host: "good.com",
        verifiedAt: "2026-07-10T00:00:00.000Z",
        source: "workspace-setting",
      },
      ...(options?.redirectAllowlist === undefined ? {} : { redirectAllowlist: options.redirectAllowlist }),
      ...(options?.egressAllowlist === undefined ? {} : { egressAllowlist: options.egressAllowlist }),
    },
  ] });
  return new OriginRegistry({ repo });
}

test("createVerifiedOrigin allows https for a workspace-setting origin", () => {
  const origin = createVerifiedOrigin({
    scheme: "https",
    host: "good.com",
    verifiedAt: "2026-07-10T00:00:00.000Z",
    source: "workspace-setting",
  });
  assert.equal(origin.scheme, "https");
});

test("createVerifiedOrigin allows http only for dev-capability", () => {
  const origin = createVerifiedOrigin({
    scheme: "http",
    host: "localhost",
    port: 3000,
    verifiedAt: "2026-07-10T00:00:00.000Z",
    source: "dev-capability",
  });
  assert.equal(origin.scheme, "http");
});

test("createVerifiedOrigin rejects http for a workspace-setting origin", () => {
  assert.throws(
    () =>
      createVerifiedOrigin({
        scheme: "http",
        host: "good.com",
        verifiedAt: "2026-07-10T00:00:00.000Z",
        source: "workspace-setting",
      }),
    InsecureOriginSourceError
  );
});

test("InMemoryOriginSettingRepo seeding rejects an insecure workspace-setting origin", () => {
  assert.throws(
    () =>
      new InMemoryOriginSettingRepo({ seeds: [
        {
          workspaceId: WORKSPACE,
          origin: {
            scheme: "http",
            host: "good.com",
            verifiedAt: "2026-07-10T00:00:00.000Z",
            source: "workspace-setting",
          },
        },
      ] }),
    InsecureOriginSourceError
  );
});

test("canonicalOrigin resolves the registered origin for a workspace", async () => {
  const registry = makeRegistry();
  const origin = await registry.canonicalOrigin({ workspaceId: WORKSPACE });
  assert.equal(origin.host, "good.com");
  assert.equal(origin.scheme, "https");
});

test("canonicalOrigin fails closed for an unregistered workspace", async () => {
  const registry = makeRegistry();
  await assert.rejects(
    () => registry.canonicalOrigin({ workspaceId: "unknown-workspace" }),
    OriginNotVerifiedError
  );
});

test("isAllowedRedirectTarget allows the exact canonical origin", async () => {
  const registry = makeRegistry();
  assert.equal(await registry.isAllowedRedirectTarget({ context: { workspaceId: WORKSPACE }, url: "https://good.com/path" }), true);
});

test("isAllowedRedirectTarget allows an allowlisted cross-origin host", async () => {
  const registry = makeRegistry({ redirectAllowlist: ["partner.com"] });
  assert.equal(await registry.isAllowedRedirectTarget({ context: { workspaceId: WORKSPACE }, url: "https://partner.com/x" }), true);
});

test("isAllowedRedirectTarget rejects a non-allowlisted cross-origin host", async () => {
  const registry = makeRegistry();
  assert.equal(await registry.isAllowedRedirectTarget({ context: { workspaceId: WORKSPACE }, url: "https://elsewhere.com" }), false);
});

test("isAllowedRedirectTarget rejects protocol-relative //evil.com", async () => {
  const registry = makeRegistry();
  assert.equal(await registry.isAllowedRedirectTarget({ context: { workspaceId: WORKSPACE }, url: "//evil.com" }), false);
});

test("isAllowedRedirectTarget rejects userinfo bypass https://good.com@evil.com", async () => {
  const registry = makeRegistry();
  assert.equal(
    await registry.isAllowedRedirectTarget({ context: { workspaceId: WORKSPACE }, url: "https://good.com@evil.com" }),
    false
  );
});

test("isAllowedRedirectTarget rejects a subdomain-confusable host not on the allowlist", async () => {
  const registry = makeRegistry();
  assert.equal(
    await registry.isAllowedRedirectTarget({ context: { workspaceId: WORKSPACE }, url: "https://good.com.evil.com" }),
    false
  );
});

test("isAllowedRedirectTarget rejects a backslash scheme-separator bypass", async () => {
  const registry = makeRegistry();
  assert.equal(await registry.isAllowedRedirectTarget({ context: { workspaceId: WORKSPACE }, url: "https:/\\evil.com" }), false);
});

test("isAllowedRedirectTarget allows the canonical host with a trailing dot stripped", async () => {
  const registry = makeRegistry();
  assert.equal(await registry.isAllowedRedirectTarget({ context: { workspaceId: WORKSPACE }, url: "https://good.com./path" }), true);
});

test("isAllowedRedirectTarget matches the canonical host case-insensitively", async () => {
  const registry = makeRegistry();
  assert.equal(await registry.isAllowedRedirectTarget({ context: { workspaceId: WORKSPACE }, url: "https://GOOD.COM/path" }), true);
});

test("isAllowedRedirectTarget rejects non-https schemes (http, javascript, data)", async () => {
  const registry = makeRegistry();
  assert.equal(await registry.isAllowedRedirectTarget({ context: { workspaceId: WORKSPACE }, url: "http://good.com" }), false);
  assert.equal(
    await registry.isAllowedRedirectTarget({ context: { workspaceId: WORKSPACE }, url: "javascript:alert(1)" }),
    false
  );
  assert.equal(
    await registry.isAllowedRedirectTarget({ context: { workspaceId: WORKSPACE }, url: "data:text/html,evil" }),
    false
  );
});

test("isAllowedRedirectTarget allows http same-origin against a dev-capability canonical origin (R2-005 fix)", async () => {
  const repo = new InMemoryOriginSettingRepo({ seeds: [
    {
      workspaceId: WORKSPACE,
      origin: {
        scheme: "http",
        host: "localhost",
        port: 3000,
        verifiedAt: "2026-07-10T00:00:00.000Z",
        source: "dev-capability",
      },
    },
  ] });
  const registry = new OriginRegistry({ repo });
  assert.equal(await registry.isAllowedRedirectTarget({ context: { workspaceId: WORKSPACE }, url: "http://localhost:3000/foo" }), true);
});

test("isAllowedRedirectTarget still rejects a cross-origin http target against a dev-capability canonical origin", async () => {
  const repo = new InMemoryOriginSettingRepo({ seeds: [
    {
      workspaceId: WORKSPACE,
      origin: {
        scheme: "http",
        host: "localhost",
        port: 3000,
        verifiedAt: "2026-07-10T00:00:00.000Z",
        source: "dev-capability",
      },
      redirectAllowlist: ["other.com"],
    },
  ] });
  const registry = new OriginRegistry({ repo });
  assert.equal(await registry.isAllowedRedirectTarget({ context: { workspaceId: WORKSPACE }, url: "http://other.com" }), false);
  assert.equal(await registry.isAllowedRedirectTarget({ context: { workspaceId: WORKSPACE }, url: "https://other.com" }), true);
});

test("isAllowedRedirectTarget rejects a malformed URL instead of throwing", async () => {
  const registry = makeRegistry();
  assert.equal(await registry.isAllowedRedirectTarget({ context: { workspaceId: WORKSPACE }, url: "not a url" }), false);
});

test("isAllowedRedirectTarget rejects whitespace-embedded bypass attempts", async () => {
  const registry = makeRegistry();
  assert.equal(
    await registry.isAllowedRedirectTarget({ context: { workspaceId: WORKSPACE }, url: "https://good.com\t.evil.com" }),
    false
  );
});

test("isAllowedRedirectTarget fails closed when the workspace has no verified origin", async () => {
  const registry = makeRegistry();
  assert.equal(
    await registry.isAllowedRedirectTarget({ context: { workspaceId: "unregistered-workspace" }, url: "https://good.com" }),
    false
  );
});

test("isAllowedEgressTarget allows the canonical origin", async () => {
  const registry = makeRegistry();
  assert.equal(await registry.isAllowedEgressTarget({ context: { workspaceId: WORKSPACE }, url: "https://good.com" }), true);
});

test("isAllowedEgressTarget uses a separate allowlist from redirects", async () => {
  const registry = makeRegistry({
    redirectAllowlist: ["redirect-partner.com"],
    egressAllowlist: ["egress-partner.com"],
  });

  assert.equal(
    await registry.isAllowedEgressTarget({ context: { workspaceId: WORKSPACE }, url: "https://egress-partner.com" }),
    true
  );
  assert.equal(
    await registry.isAllowedEgressTarget({ context: { workspaceId: WORKSPACE }, url: "https://redirect-partner.com" }),
    false
  );
  assert.equal(
    await registry.isAllowedRedirectTarget({ context: { workspaceId: WORKSPACE }, url: "https://egress-partner.com" }),
    false
  );
});

test("isAllowedEgressTarget rejects the same bypass strings as redirects", async () => {
  const registry = makeRegistry();
  assert.equal(await registry.isAllowedEgressTarget({ context: { workspaceId: WORKSPACE }, url: "https://good.com@evil.com" }), false);
  assert.equal(await registry.isAllowedEgressTarget({ context: { workspaceId: WORKSPACE }, url: "//evil.com" }), false);
});

test("redirect and egress require matching effective ports for canonical and dev origins", async () => {
  const canonical = makeRegistry();
  const dev = new OriginRegistry({ repo: new InMemoryOriginSettingRepo({ seeds: [{
    workspaceId: WORKSPACE,
    origin: { scheme: "http", host: "localhost", port: 3000, verifiedAt: "2026-07-10T00:00:00.000Z", source: "dev-capability" },
  }] }) });
  const custom = new OriginRegistry({ repo: new InMemoryOriginSettingRepo({ seeds: [{
    workspaceId: WORKSPACE,
    origin: { scheme: "https", host: "good.com", port: 8443, verifiedAt: "2026-07-10T00:00:00.000Z", source: "workspace-setting" },
  }] }) });
  for (const oracle of ["isAllowedRedirectTarget", "isAllowedEgressTarget"] as const) {
    assert.equal(await canonical[oracle]({ context: { workspaceId: WORKSPACE }, url: "https://good.com:443/path" }), true);
    assert.equal(await canonical[oracle]({ context: { workspaceId: WORKSPACE }, url: "https://good.com:8443/path" }), false);
    assert.equal(await custom[oracle]({ context: { workspaceId: WORKSPACE }, url: "https://good.com:8443/path" }), true);
    assert.equal(await custom[oracle]({ context: { workspaceId: WORKSPACE }, url: "https://good.com/path" }), false);
    assert.equal(await dev[oracle]({ context: { workspaceId: WORKSPACE }, url: "http://localhost:3000/path" }), true);
    assert.equal(await dev[oracle]({ context: { workspaceId: WORKSPACE }, url: "http://localhost:3001/path" }), false);
  }
});

test("redirect and egress allowlists require exact hosts, rejecting suffix and substring confusables", async () => {
  const registry = makeRegistry({ redirectAllowlist: ["partner.com"], egressAllowlist: ["api.example.com"] });
  for (const [oracle, host] of [
    ["isAllowedRedirectTarget", "partner.com"],
    ["isAllowedEgressTarget", "api.example.com"],
  ] as const) {
    assert.equal(await registry[oracle]({ context: { workspaceId: WORKSPACE }, url: `https://${host}` }), true);
    for (const candidate of [`evil${host}`, `sub.${host}`, `${host}.evil.com`]) {
      assert.equal(await registry[oracle]({ context: { workspaceId: WORKSPACE }, url: `https://${candidate}` }), false, candidate);
    }
  }
});

test("redirect and egress fail closed when their allowlist lookup rejects", async () => {
  const repo = new InMemoryOriginSettingRepo({ seeds: [{
    workspaceId: WORKSPACE,
    origin: { scheme: "https", host: "good.com", verifiedAt: "2026-07-10T00:00:00.000Z", source: "workspace-setting" },
  }] });
  let redirectLookups = 0;
  let egressLookups = 0;
  repo.findRedirectAllowlist = async () => { redirectLookups++; throw new Error("redirect lookup failed"); };
  repo.findEgressAllowlist = async () => { egressLookups++; throw new Error("egress lookup failed"); };
  const registry = new OriginRegistry({ repo });
  assert.equal(await registry.isAllowedRedirectTarget({ context: { workspaceId: WORKSPACE }, url: "https://partner.com" }), false);
  assert.equal(await registry.isAllowedEgressTarget({ context: { workspaceId: WORKSPACE }, url: "https://api.example.com" }), false);
  assert.equal(redirectLookups, 1);
  assert.equal(egressLookups, 1);
});
