import assert from "node:assert/strict";
import { test } from "vitest";

import { checkSitePathname, checkSiteRelativeTarget } from "../reserved-paths.js";

/**
 * @file The shared reserved-path rule (`reserved-paths.ts`) and its characterization cases (the
 * host-side pin that keeps its consumers on one copy stays with the host).
 *
 * The rule exists because the public site, the admin SPA (`app.use("/admin", ...)`) and the admin
 * API (`app.use("/api/admin", ...)`) are one Express app, so a "site path" can name the
 * authenticated surface. Two features must refuse that — a published-page fetch tool and a
 * redirects write chokepoint — and the failure mode being guarded
 * against is not "neither checks" but "one of them is a decode, a case-fold or a dot segment
 * behind the other".
 */

// ---------------------------------------------------------------------------
// checkSitePathname — the rule itself
// ---------------------------------------------------------------------------

/** `checkSitePathname` now takes a `URL`, not a bare string — see its own doc for why. This base
 *  is only for parsing test fixture pathnames into one; it is never a real destination. */
const TEST_BASE = "http://reserved-paths-test.invalid";

/**
 * Turns a fixture `pathname` into the `URL` `checkSitePathname` now requires.
 *
 * Builds the absolute string by CONCATENATION (`base + pathname`), not `new URL(pathname, base)`.
 * The two-argument form treats a leading `//` as protocol-relative and resolves it onto a
 * different origin — exactly the `RESERVED` fixture `"//admin"` — while concatenation keeps it as
 * a literal double slash inside the path, which is what a real `URL.pathname` can also contain
 * (e.g. `new URL("http://x//admin").pathname === "//admin"`) and what `resolveDotSegments` exists
 * to collapse.
 */
function checkSitePathnameFixture(pathname: string): ReturnType<typeof checkSitePathname> {
  return checkSitePathname({ url: new URL(TEST_BASE + pathname) });
}

const RESERVED: readonly (readonly [string, "admin" | "api"])[] = [
  ["/admin", "admin"],
  ["/admin/", "admin"],
  ["/admin/settings", "admin"],
  ["/%61dmin", "admin"],
  ["/%41DMIN/settings", "admin"],
  ["/ADMIN", "admin"],
  ["/AdMiN/settings", "admin"],
  ["/blog/../admin", "admin"],
  ["/blog/%2e%2e/admin", "admin"],
  ["/blog%2F..%2Fadmin", "admin"],
  ["/blog%2f%2e%2e%2fAPI/tools", "api"],
  ["/one%2Ftwo%2F..%2F..%2Fadmin", "admin"],
  ["/x%23section%2F..%2Fapi", "api"],
  ["//admin", "admin"],
  ["/api", "api"],
  ["/api/admin/v1/auth/me", "api"],
  ["/API/tools/list", "api"],
  ["/%61pi/runs", "api"],
];

for (const [pathname, surface] of RESERVED) {
  test(`checkSitePathname refuses '${pathname}' as the '${surface}' surface`, () => {
    assert.deepEqual(checkSitePathnameFixture(pathname), { kind: "reserved", surface });
  });
}

const ORDINARY: readonly string[] = [
  "/",
  "/administer-survey",
  "/administration/policies",
  "/admins",
  "/apiary",
  "/api-docs",
  "/blog/admin-interview",
];

for (const pathname of ORDINARY) {
  test(`checkSitePathname allows the ordinary site path '${pathname}'`, () => {
    assert.deepEqual(checkSitePathnameFixture(pathname), { kind: "ok" });
  });
}

test("checkSitePathname reports a malformed percent-encoding rather than throwing", () => {
  assert.deepEqual(checkSitePathnameFixture("/%"), { kind: "malformed-encoding" });
  assert.deepEqual(checkSitePathnameFixture("/%zz"), { kind: "malformed-encoding" });
});

test("checkSitePathname refuses a path that DECODES to a backslash or a control character", () => {
  assert.deepEqual(checkSitePathnameFixture("/%5Cevil.example"), { kind: "disallowed-character" });
  assert.deepEqual(checkSitePathnameFixture("/ok%0d%0aX-Injected:%201"), { kind: "disallowed-character" });
});

test("checkSitePathname decodes exactly ONCE, matching what a browser puts on the wire", () => {
  // `/%2561dmin` is what the server receives; it decodes to the literal `/%61dmin`, which is a
  // real (if silly) page path and not `/admin`. Decoding twice here would refuse a legal path.
  assert.deepEqual(checkSitePathnameFixture("/%2561dmin"), { kind: "ok" });
});

// ---------------------------------------------------------------------------
// checkSiteRelativeTarget — the structural pass a raw reference also needs
// ---------------------------------------------------------------------------

test("checkSiteRelativeTarget refuses a backslash-disguised protocol-relative reference", () => {
  // One leading slash, so `startsWith("//")` says site-relative; a URL parser says evil.example.
  assert.deepEqual(checkSiteRelativeTarget({ raw: "/\\evil.example" }), { kind: "off-origin" });
  assert.deepEqual(checkSiteRelativeTarget({ raw: "/\\\\evil.example/x" }), { kind: "off-origin" });
});

test("checkSiteRelativeTarget refuses a raw control character before parsing", () => {
  assert.deepEqual(checkSiteRelativeTarget({ raw: "/ok\r\nX-Injected: 1" }), { kind: "disallowed-character" });
});

/**
 * t85 independent review (2026-09-16): the structural pass asks "did the origin survive resolution
 * against the probe origin", so a reference that NAMES the probe origin answered that question
 * trivially and came back `ok` — a reference off this site, approved by the check whose entire job
 * is refusing exactly that. Reachable through `/store/buy?returnTo=//reserved-path-probe.invalid/x`,
 * which is a protocol-relative `Location` a browser leaves the site for. Resolving against TWO
 * different probe origins and requiring the answer to track the base is what makes the sentinel
 * unnameable, rather than a denylist of its spellings.
 */
test("checkSiteRelativeTarget refuses a reference that names the probe origin it resolves against", () => {
  assert.deepEqual(checkSiteRelativeTarget({ raw: "//reserved-path-probe.invalid/x" }), { kind: "off-origin" });
  assert.deepEqual(checkSiteRelativeTarget({ raw: "http://reserved-path-probe.invalid/x" }), { kind: "off-origin" });
  assert.deepEqual(checkSiteRelativeTarget({ raw: "/\\reserved-path-probe.invalid/x" }), { kind: "off-origin" });
});

test("checkSiteRelativeTarget passes an ordinary relative target, query and fragment included", () => {
  assert.deepEqual(checkSiteRelativeTarget({ raw: "/new" }), { kind: "ok" });
  assert.deepEqual(checkSiteRelativeTarget({ raw: "/new?utm=1#section" }), { kind: "ok" });
  assert.deepEqual(checkSiteRelativeTarget({ raw: "new/page" }), { kind: "ok" });
});

test("checkSiteRelativeTarget still applies the reserved-surface rule after parsing", () => {
  assert.deepEqual(checkSiteRelativeTarget({ raw: "/%61dmin/settings?x=1" }), { kind: "reserved", surface: "admin" });
});

test("checkSiteRelativeTarget reports an unparseable reference", () => {
  assert.deepEqual(checkSiteRelativeTarget({ raw: "http://[" }), { kind: "unparseable" });
});
