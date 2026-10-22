import assert from "node:assert/strict";
import { test, vi, afterEach } from "vitest";

import { OriginNotVerifiedError, type OriginRegistryPort, type VerifiedOrigin } from "@jini-ai/http-kit/verified-origin";
import { resolveWorkspaceOrigin, toAbsoluteUrl } from "./support/legacy-api.fixture.js";

/**
 * @file Direct unit certification of `toAbsoluteUrl`/`resolveWorkspaceOrigin` (2026-09-03 absolute-URL
 * fix) — the join logic `seo.ts`'s `resolveCanonical`/`resolveShareImages` and
 * `routes/site/pages.ts`'s `buildExtraHead` both delegate to. Reproduced defect (both production and
 * local, via `curl`, before this fix existed): every page's `canonical`/`og:url` was a bare relative
 * path, and `og:image` (via `resolveSeoImageRef`'s `/m/...` contract) the same — a hard failure for
 * Open Graph, which requires `og:url`/`og:image` to be absolute.
 */

const ORIGIN: VerifiedOrigin = {
  scheme: "https",
  host: "example.test",
  verifiedAt: "2026-09-03T00:00:00.000Z",
  source: "workspace-setting",
};

test("toAbsoluteUrl: joins an ordinary path onto the verified origin", () => {
  assert.equal(toAbsoluteUrl(ORIGIN, "/documentation"), "https://example.test/documentation");
});

test("toAbsoluteUrl: the root path '/' joins to exactly one trailing slash, never '//' (2026-09-03 fix requirement)", () => {
  assert.equal(toAbsoluteUrl(ORIGIN, "/"), "https://example.test/");
});

test("toAbsoluteUrl: includes a non-default port in the authority", () => {
  const origin: VerifiedOrigin = { ...ORIGIN, host: "localhost", port: 3000, scheme: "http", source: "dev-capability" };
  assert.equal(toAbsoluteUrl(origin, "/docs"), "http://localhost:3000/docs");
});

test("toAbsoluteUrl: preserves the origin's own basePath without doubling a slash", () => {
  const origin: VerifiedOrigin = { ...ORIGIN, basePath: "/site" };
  assert.equal(toAbsoluteUrl(origin, "/"), "https://example.test/site/");
  assert.equal(toAbsoluteUrl(origin, "/pricing"), "https://example.test/site/pricing");
});

test("toAbsoluteUrl: an already-absolute path is returned unchanged, never double-prefixed (EC-10 cross-domain override)", () => {
  assert.equal(toAbsoluteUrl(ORIGIN, "https://other-domain.example/elsewhere"), "https://other-domain.example/elsewhere");
});

test("toAbsoluteUrl: a protocol-relative path is treated as already-absolute and left unchanged", () => {
  assert.equal(toAbsoluteUrl(ORIGIN, "//cdn.example.com/x.jpg"), "//cdn.example.com/x.jpg");
});

test("toAbsoluteUrl: no verified origin (undefined) degrades to the bare relative path unchanged — the disclosed fallback", () => {
  assert.equal(toAbsoluteUrl(undefined, "/documentation"), "/documentation");
  assert.equal(toAbsoluteUrl(undefined, "/"), "/");
});

test("toAbsoluteUrl: an og:image-shaped '/m/...' media URL becomes absolute", () => {
  assert.equal(toAbsoluteUrl(ORIGIN, "/m/asset-1/og.v1/image.jpg"), "https://example.test/m/asset-1/og.v1/image.jpg");
});

function fakeOriginRegistry(origin: VerifiedOrigin | Error): OriginRegistryPort {
  return {
    async canonicalOrigin() {
      if (origin instanceof Error) throw origin;
      return origin;
    },
    async isAllowedRedirectTarget() {
      return false;
    },
    async isAllowedEgressTarget() {
      return false;
    },
  };
}

test("resolveWorkspaceOrigin: returns the verified origin when one is registered", async () => {
  const other: VerifiedOrigin = { ...ORIGIN, host: "other.test" };
  const origins = new Map([["workspace-1", ORIGIN], ["workspace-2", other]]);
  const registry: OriginRegistryPort = {
    ...fakeOriginRegistry(ORIGIN),
    async canonicalOrigin({ workspaceId }) {
      const origin = origins.get(workspaceId);
      assert.ok(origin, `unexpected workspace ${workspaceId}`);
      return origin;
    },
  };
  assert.deepEqual(await resolveWorkspaceOrigin(registry, "workspace-1"), ORIGIN);
  assert.deepEqual(await resolveWorkspaceOrigin(registry, "workspace-2"), other);
});

test("resolveWorkspaceOrigin: degrades to undefined on OriginNotVerifiedError, the documented no-origin fallback", async () => {
  const result = await resolveWorkspaceOrigin(
    fakeOriginRegistry(new OriginNotVerifiedError({ message: "no verified origin registered" })),
    "workspace-1"
  );
  assert.equal(result, undefined);
});

test("resolveWorkspaceOrigin: any OTHER error is rethrown, not silently swallowed into the same fallback", async () => {
  await assert.rejects(
    () => resolveWorkspaceOrigin(fakeOriginRegistry(new Error("registry is down")), "workspace-1"),
    /registry is down/
  );
});

const DEV_CAPABILITY_ORIGIN: VerifiedOrigin = {
  scheme: "http",
  host: "localhost",
  port: 3000,
  verifiedAt: "2026-07-16T00:00:00.000Z",
  source: "dev-capability",
};

// 2026-09-18 production sitemap fix (reproduced live on tovu.fly.dev): `seedDevCapabilityOrigin`
// (server/runtime/composition/deps.ts) unconditionally persists `http://localhost:3000` as the
// registered origin on first boot, including in production, and its idempotent find-or-create
// contract means that row is never overwritten by a later boot. Without this guard, every public
// SEO document built from it — sitemap.xml chief among them — leaks that dev origin to real
// crawlers forever.
test("resolveWorkspaceOrigin: a dev-capability origin (http://localhost:3000) degrades to undefined in production runtime mode -- must never leak into a public SEO URL", async () => {
  const result = await resolveWorkspaceOrigin(
    fakeOriginRegistry(DEV_CAPABILITY_ORIGIN),
    "workspace-1",
    () => "production"
  );
  assert.equal(result, undefined);
});

test("resolveWorkspaceOrigin: a dev-capability origin still resolves normally outside production (local mode, unchanged pre-existing behavior)", async () => {
  const result = await resolveWorkspaceOrigin(fakeOriginRegistry(DEV_CAPABILITY_ORIGIN), "workspace-1", () => "local");
  assert.deepEqual(result, DEV_CAPABILITY_ORIGIN);
});

test("resolveWorkspaceOrigin: a real workspace-setting origin is never degraded by production mode", async () => {
  const result = await resolveWorkspaceOrigin(fakeOriginRegistry(ORIGIN), "workspace-1", () => "production");
  assert.deepEqual(result, ORIGIN);
});

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
