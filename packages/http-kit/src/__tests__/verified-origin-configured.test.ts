import assert from "node:assert/strict";
import { test } from "vitest";

import { planOriginBoot, resolveConfiguredOrigin } from "../verified-origin.js";
import type { VerifiedOrigin } from "../verified-origin.js";

const NOW = "2026-09-18T00:00:00.000Z";

function capture() {
  const warnings: string[] = [];
  return { warnings, warn: (message: string) => warnings.push(message) };
}

function resolve(value: string | undefined) {
  const { warnings, warn } = capture();
  const env = value === undefined ? {} : { APP_PUBLIC_URL: value };
  const origin = resolveConfiguredOrigin({ clock: { nowIso: () => NOW }, env, envVarName: "APP_PUBLIC_URL", warn });
  return { origin, warnings };
}

function refusalMessage(reason: string, value: string): string {
  return (
    `APP_PUBLIC_URL is set but was refused as this deployment's public origin (${reason}); ` +
    `no origin was registered from it. Value: ${value}`
  );
}

test("resolveConfiguredOrigin: a valid public https URL yields a workspace-setting VerifiedOrigin", () => {
  const { origin, warnings } = resolve("https://product.fly.dev");
  const expected: VerifiedOrigin = {
    scheme: "https",
    host: "product.fly.dev",
    verifiedAt: NOW,
    source: "workspace-setting",
  };
  assert.deepStrictEqual(origin, expected);
  assert.deepEqual(warnings, []);
});
test("resolveConfiguredOrigin: omits the port and basePath keys entirely when the URL has neither", () => {
  const { origin } = resolve("https://product.fly.dev/");
  assert.deepStrictEqual(Object.keys(origin ?? {}).sort(), ["host", "scheme", "source", "verifiedAt"]);
});

test("resolveConfiguredOrigin: keeps an explicit non-default port", () => {
  const { origin } = resolve("https://product.example:8443");
  assert.equal(origin?.port, 8443);
});

test("resolveConfiguredOrigin: keeps a basePath and strips its trailing slash", () => {
  assert.equal(resolve("https://product.example/site/").origin?.basePath, "/site");
  assert.equal(resolve("https://product.example/site").origin?.basePath, "/site");
});

test("resolveConfiguredOrigin: lower-cases the host and strips a single trailing dot", () => {
  assert.equal(resolve("https://Product.Fly.Dev./").origin?.host, "product.fly.dev");
});

test("resolveConfiguredOrigin: an unset APP_PUBLIC_URL yields undefined and warns nothing", () => {
  const { origin, warnings } = resolve(undefined);
  assert.equal(origin, undefined);
  assert.deepEqual(warnings, [], "an unset public URL is the normal local-dev case, not an operator error");
});

test("resolveConfiguredOrigin: a blank APP_PUBLIC_URL yields undefined and warns nothing", () => {
  const { origin, warnings } = resolve("   ");
  assert.equal(origin, undefined);
  assert.deepEqual(warnings, []);
});

test("resolveConfiguredOrigin: an unparseable value is refused with the exact warning", () => {
  const { origin, warnings } = resolve("not a url");
  assert.equal(origin, undefined);
  assert.deepEqual(warnings, [refusalMessage("it is not a parseable URL", "not a url")]);
});
test("resolveConfiguredOrigin: a backslash in the raw value is refused with the exact warning", () => {
  const { origin, warnings } = resolve("https:/\\product.fly.dev");
  assert.equal(origin, undefined);
  assert.deepEqual(warnings, [refusalMessage("it is not a parseable URL", "https:/\\product.fly.dev")]);
});
test("resolveConfiguredOrigin: an http URL is refused with the exact warning (ADR-040 https-only)", () => {
  const { origin, warnings } = resolve("http://product.fly.dev");
  assert.equal(origin, undefined);
  assert.deepEqual(warnings, [refusalMessage("its scheme must be https", "http://product.fly.dev")]);
});

test("resolveConfiguredOrigin: a non-http(s) scheme is refused with the exact warning", () => {
  const { origin, warnings } = resolve("ftp://product.fly.dev");
  assert.equal(origin, undefined);
  assert.deepEqual(warnings, [refusalMessage("its scheme must be https", "ftp://product.fly.dev")]);
});

test("resolveConfiguredOrigin: a userinfo component is refused with the exact warning", () => {
  const { origin, warnings } = resolve("https://user:pw@product.fly.dev");
  assert.equal(origin, undefined);
  assert.deepEqual(warnings, [
    refusalMessage("it carries a userinfo component", "https://user:pw@product.fly.dev"),
  ]);
});

test("resolveConfiguredOrigin: a query string is refused with the exact warning", () => {
  const { origin, warnings } = resolve("https://product.fly.dev/?a=1");
  assert.equal(origin, undefined);
  assert.deepEqual(warnings, [
    refusalMessage("it carries a query string or fragment", "https://product.fly.dev/?a=1"),
  ]);
});

test("resolveConfiguredOrigin: a fragment is refused with the exact warning", () => {
  const { origin, warnings } = resolve("https://product.fly.dev/#x");
  assert.equal(origin, undefined);
  assert.deepEqual(warnings, [
    refusalMessage("it carries a query string or fragment", "https://product.fly.dev/#x"),
  ]);
});

test("resolveConfiguredOrigin: https://localhost:3000 -- this repo's own .env value -- is refused as a loopback host", () => {
  const { origin, warnings } = resolve("https://localhost:3000");
  assert.equal(origin, undefined, "a loopback host can never be a public origin");
  assert.deepEqual(warnings, [
    refusalMessage("'localhost' is a loopback host, not a public origin", "https://localhost:3000"),
  ]);
});

test("resolveConfiguredOrigin: every loopback identity is refused", () => {
  for (const [value, host] of [
    ["https://127.0.0.1", "127.0.0.1"],
    ["https://127.1.2.3:8443", "127.1.2.3"],
    ["https://app.localhost", "app.localhost"],
    ["https://[::1]", "[::1]"],
    ["https://0.0.0.0", "0.0.0.0"],
  ] as const) {
    const { origin, warnings } = resolve(value);
    assert.equal(origin, undefined, `${value} must be refused`);
    assert.deepEqual(warnings, [
      refusalMessage(`'${host}' is a loopback host, not a public origin`, value),
    ]);
  }
});

test("resolveConfiguredOrigin: never throws, whatever the configured value is", () => {
  for (const value of ["", "://", "https://", "https:", "\u0000", "javascript:alert(1)", "//product.fly.dev", "https://product.fly.dev\n"]) {
    assert.doesNotThrow(() => resolveConfiguredOrigin({ clock: { nowIso: () => NOW }, env: { APP_PUBLIC_URL: value }, envVarName: "APP_PUBLIC_URL", warn: () => {} }), `threw on ${JSON.stringify(value)}`);
  }
});

const NO_CONFIG_IN_PRODUCTION_WARNING =
  "No public origin is configured for this production deployment: APP_PUBLIC_URL is unset or was " +
  "refused, and the localhost dev-capability seed is never written in production runtime mode. " +
  "Public URLs (sitemap.xml, canonical, og:url, newsletter and magic links) stay relative or " +
  "unavailable until APP_PUBLIC_URL names this deployment's origin.";

function plan(value: string | undefined, mode: "production" | "local") {
  const { warnings, warn } = capture();
  const env = value === undefined ? {} : { APP_PUBLIC_URL: value };
  return { result: planOriginBoot({ clock: { nowIso: () => NOW }, env, envVarName: "APP_PUBLIC_URL", warn, allowDevSeed: () => mode !== "production", missingOriginWarning: NO_CONFIG_IN_PRODUCTION_WARNING }), warnings };
}

test("planOriginBoot: a configured public origin is registered, in production", () => {
  const { result, warnings } = plan("https://product.fly.dev", "production");
  assert.equal(result.kind, "configured");
  assert.equal(result.kind === "configured" ? result.origin.host : undefined, "product.fly.dev");
  assert.deepEqual(warnings, []);
});

test("planOriginBoot: a configured public origin is registered in local mode too -- how an operator tests prod-shaped absolute URLs locally", () => {
  assert.equal(plan("https://product.fly.dev", "local").result.kind, "configured");
});

test("planOriginBoot: no configured origin in local mode falls through to the dev-capability seed (unchanged dev behavior)", () => {
  const { result, warnings } = plan(undefined, "local");
  assert.equal(result.kind, "dev-seed");
  assert.deepEqual(warnings, []);
});

test("planOriginBoot: a loopback APP_PUBLIC_URL in local mode still falls through to the dev-capability seed", () => {
  const { result } = plan("https://localhost:3000", "local");
  assert.equal(result.kind, "dev-seed", "the dev seed's deriveDevScheme must keep owning the local origin");
});
test("planOriginBoot: no configured origin in production writes nothing and warns with the exact message", () => {
  const { result, warnings } = plan(undefined, "production");
  assert.equal(result.kind, "none");
  assert.deepEqual(warnings, [NO_CONFIG_IN_PRODUCTION_WARNING]);
});

test("planOriginBoot: a loopback APP_PUBLIC_URL in production writes nothing -- never the localhost seed", () => {
  const { result, warnings } = plan("https://localhost:3000", "production");
  assert.equal(result.kind, "none");
  assert.deepEqual(warnings, [
    refusalMessage("'localhost' is a loopback host, not a public origin", "https://localhost:3000"),
    NO_CONFIG_IN_PRODUCTION_WARNING,
  ]);
});

test("resolveConfiguredOrigin accepts loopback lookalikes, canonicalizes :443 and retains nested basePath", () => {
  for (const host of ["mylocalhost.com", "127.example.com"]) {
    assert.deepEqual(resolve(`https://${host}`), { origin: { scheme: "https", host, verifiedAt: NOW, source: "workspace-setting" }, warnings: [] });
  }
  assert.deepEqual(resolve("https://x.example:443/a/b/"), {
    origin: { scheme: "https", host: "x.example", basePath: "/a/b", verifiedAt: NOW, source: "workspace-setting" }, warnings: [],
  });
});

