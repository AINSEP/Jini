import assert from "node:assert/strict";
import { test } from "vitest";

import { toCookieShapes } from "../cookie-shapes.js";

/** @file The Set-Cookie projection: name and attributes survive, the value never does. */

test("toCookieShapes: keeps the cookie name and attributes and drops the value", () => {
  const headers = new Headers();
  headers.append("set-cookie", "sid=SUPER_SECRET_SESSION_VALUE; Path=/; HttpOnly; SameSite=Lax");
  headers.append("set-cookie", "consent=; Max-Age=0");

  const shapes = toCookieShapes({ headers });
  assert.deepEqual(shapes, [
    { name: "sid", attributes: ["Path=/", "HttpOnly", "SameSite=Lax"] },
    { name: "consent", attributes: ["Max-Age=0"] },
  ]);
  assert.ok(!JSON.stringify(shapes).includes("SUPER_SECRET_SESSION_VALUE"));
});

test("toCookieShapes: no cookie VALUE survives, whatever shape the value has", () => {
  const sentinel = "SENTINEL_COOKIE_VALUE_8f3a";
  const headers = new Headers();
  headers.append("set-cookie", `plain=${sentinel}; Path=/; HttpOnly`);
  headers.append("set-cookie", `with-equals=${sentinel}=${sentinel}==; Secure`);
  headers.append("set-cookie", `quoted="${sentinel}"; Max-Age=60`);
  headers.append("set-cookie", `__Host-dated=${sentinel}; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Path=/`);
  headers.append("set-cookie", "bare; Secure");

  const shapes = toCookieShapes({ headers });
  assert.deepEqual(shapes, [
    { name: "plain", attributes: ["Path=/", "HttpOnly"] },
    { name: "with-equals", attributes: ["Secure"] },
    { name: "quoted", attributes: ["Max-Age=60"] },
    { name: "__Host-dated", attributes: ["Expires=Wed, 21 Oct 2026 07:28:00 GMT", "Path=/"] },
    { name: "bare", attributes: ["Secure"] },
  ]);
  assert.ok(!JSON.stringify(shapes).includes(sentinel), "a cookie VALUE must never appear in a cookie shape");
});

test("toCookieShapes: attributes are trimmed, empty ones dropped, and no Set-Cookie header gives no shapes", () => {
  const headers = new Headers();
  headers.append("set-cookie", " spaced = v ;; Path=/ ;  ; SameSite=Lax ");
  assert.deepEqual(toCookieShapes({ headers }), [{ name: "spaced", attributes: ["Path=/", "SameSite=Lax"] }]);
  assert.deepEqual(toCookieShapes({ headers: new Headers({ "content-type": "text/html" }) }), []);
});

test("toCookieShapes: a runtime whose Headers has no getSetCookie reports no cookies rather than guessing at a joined header", () => {
  const legacyHeaders = { get: () => "sid=SECRET; Path=/" } as unknown as Headers;
  assert.deepEqual(toCookieShapes({ headers: legacyHeaders }), []);
});

test("toCookieShapes: a cookie with no attributes at all still yields its name", () => {
  const headers = new Headers();
  headers.append("set-cookie", "lonely=value");
  assert.deepEqual(toCookieShapes({ headers }), [{ name: "lonely", attributes: [] }]);
});
