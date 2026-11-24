import { describe, expect, it } from "vitest";

import { OAUTH_CALLBACK_FAILURE_REASONS, oauthCallbackPageResponse, type OAuthCallbackPageRenderer } from "../oauth-callback-page.js";

/** @file The shared callback-page response: fixed headers, the injected renderer's markup, nothing from the request. */

const render: OAuthCallbackPageRenderer = ({ ok, messageType, reason }) => `<p>${ok ? "ok" : `fail:${reason ?? "none"}`}:${messageType}</p>`;

describe("oauthCallbackPageResponse", () => {
  it("answers the renderer's markup as no-store HTML with the given status", async () => {
    const response = oauthCallbackPageResponse({ status: 400, render, page: { ok: false, reason: "no_state", messageType: "host:done" } });
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-length")).toBe("30");
    expect(await response.text()).toBe("<p>fail:no_state:host:done</p>");
  });

  it("adds the caller's extra headers, including repeated Set-Cookie values", () => {
    const response = oauthCallbackPageResponse(
      { status: 200, render, page: { ok: true, messageType: "m" } },
      { headers: [["Referrer-Policy", "no-referrer"], ["Set-Cookie", "a=; Max-Age=0"], ["Set-Cookie", "b=; Max-Age=0"]] },
    );
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.getSetCookie()).toEqual(["a=; Max-Age=0", "b=; Max-Age=0"]);
  });

  it("closes the failure vocabulary over exactly the eight reasons the hosts render", () => {
    expect([...OAUTH_CALLBACK_FAILURE_REASONS].sort()).toEqual([
      "account_unchanged", "browser_mismatch", "exchange_failed", "no_state", "provider_denied", "rate_limited", "server_unknown", "state_expired",
    ]);
  });
});
