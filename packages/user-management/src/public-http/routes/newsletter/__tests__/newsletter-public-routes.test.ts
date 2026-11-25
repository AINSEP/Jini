import type { RouteInputContext } from "@jini-ai/core/contracts/server";
import { describe, expect, it } from "vitest";
import { NewsletterConfirmTokenInvalidError, NewsletterUnsubscribeTokenInvalidError } from "../../../../newsletter/errors.js";
import { newsletterConfirmRoute, type NewsletterConfirmRouteDeps } from "../confirm.js";
import { newsletterUnsubscribeGetRoute, newsletterUnsubscribePostRoute, type NewsletterUnsubscribeRouteDeps } from "../unsubscribe.js";

const signal = new AbortController().signal;
const rawWith = (query: Record<string, unknown>): RouteInputContext => ({ params: {}, query, body: undefined }) as unknown as RouteInputContext;
const HTML = "text/html; charset=utf-8";

function confirmDeps(overrides: Partial<NewsletterConfirmRouteDeps> = {}): NewsletterConfirmRouteDeps & { tokens: string[]; captured: unknown[]; order: string[] } {
  const tokens: string[] = [];
  const captured: unknown[] = [];
  const order: string[] = [];
  return {
    ready: async () => { order.push("ready"); },
    consume: async ({ rawToken }) => { order.push("consume"); tokens.push(rawToken); return { changed: true, subscription: { listId: "list-1" }, eventId: "evt-1" }; },
    onSubscribed: (event) => { captured.push(event); },
    reportFailure: () => ({ errorId: "ERR-1" }),
    tokens, captured, order, ...overrides,
  };
}

describe("newsletterConfirmRoute", () => {
  it("is a buffered GET on /newsletter/confirm", () => {
    expect(newsletterConfirmRoute).toMatchObject({ method: "get", path: "/newsletter/confirm", bufferedReply: true });
  });

  it("awaits readiness, consumes the raw token, captures the subscription once and answers the 200 page", async () => {
    const deps = confirmDeps();
    const res = await newsletterConfirmRoute.handle({ raw: rawWith({ token: "tok" }), deps }, { signal });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(HTML);
    expect(await res.text()).toBe(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Subscription confirmed</title></head>
<body>
  <h1>Subscription confirmed</h1>
  <p>Your subscription is confirmed. You&#39;re all set.</p>
</body>
</html>`);
    expect(deps.order).toEqual(["ready", "consume"]);
    expect(deps.tokens).toEqual(["tok"]);
    expect(deps.captured).toEqual([{ listId: "list-1", eventId: "evt-1" }]);
  });

  it("uses an empty token when the query token is absent or not a string", async () => {
    const deps = confirmDeps();
    await newsletterConfirmRoute.handle({ raw: rawWith({ token: ["a", "b"] }), deps }, { signal });
    await newsletterConfirmRoute.handle({ raw: rawWith({}), deps }, { signal });
    expect(deps.tokens).toEqual(["", ""]);
  });

  it("does not capture an event when the confirmation changed nothing (a repeat click) but still answers 200", async () => {
    const deps = confirmDeps({ consume: async () => ({ changed: false, subscription: { listId: "list-1" }, eventId: "evt-1" }) });
    const res = await newsletterConfirmRoute.handle({ raw: rawWith({ token: "t" }), deps }, { signal });
    expect(res.status).toBe(200);
    expect(deps.captured).toEqual([]);
  });

  it("answers the 400 invalid-link page for an invalid confirmation token", async () => {
    const deps = confirmDeps({ consume: async () => { throw new NewsletterConfirmTokenInvalidError({ message: "bad", reason: "expired" }); } });
    const res = await newsletterConfirmRoute.handle({ raw: rawWith({ token: "t" }), deps }, { signal });
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toBe(HTML);
    const body = await res.text();
    expect(body).toContain("<h1>Confirmation link invalid</h1>");
    expect(body).toContain("<p>This confirmation link is invalid or has expired. Please request a new one.</p>");
    expect(deps.captured).toEqual([]);
  });

  it("answers the 500 page carrying the reported error id for any other failure", async () => {
    const seen: unknown[] = [];
    const boom = new Error("db down");
    const deps = confirmDeps({ consume: async () => { throw boom; }, reportFailure: ({ error }) => { seen.push(error); return { errorId: "ERR-9" }; } });
    const res = await newsletterConfirmRoute.handle({ raw: rawWith({ token: "t" }), deps }, { signal });
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toBe(HTML);
    const body = await res.text();
    expect(body).toContain("<h1>Subscription confirmation unavailable</h1>");
    expect(body).toContain("report this error ID if it keeps happening. Error ID: ERR-9</p>");
    expect(seen).toEqual([boom]);
  });

  it("lets a readiness rejection reach the host (it is awaited outside the failure ladder)", async () => {
    const deps = confirmDeps({ ready: async () => { throw new Error("not ready"); } });
    await expect(newsletterConfirmRoute.handle({ raw: rawWith({ token: "t" }), deps }, { signal })).rejects.toThrow("not ready");
  });

  it("escapes markup in the error id", async () => {
    const deps = confirmDeps({ consume: async () => { throw new Error("x"); }, reportFailure: () => ({ errorId: "<b>&" }) });
    const res = await newsletterConfirmRoute.handle({ raw: rawWith({ token: "t" }), deps }, { signal });
    expect(await res.text()).toContain("Error ID: &lt;b&gt;&amp;</p>");
  });
});

function unsubscribeDeps(overrides: Partial<NewsletterUnsubscribeRouteDeps> = {}): NewsletterUnsubscribeRouteDeps & { tokens: string[] } {
  const tokens: string[] = [];
  return {
    ready: async () => {},
    unsubscribe: async ({ rawToken }) => { tokens.push(rawToken); return { outcome: "unsubscribed" }; },
    reportFailure: () => ({ errorId: "ERR-2" }),
    tokens, ...overrides,
  };
}

describe("newsletterUnsubscribe routes", () => {
  it("are one buffered GET and one buffered POST on /newsletter/unsubscribe sharing a handler", () => {
    expect(newsletterUnsubscribeGetRoute).toMatchObject({ method: "get", path: "/newsletter/unsubscribe", bufferedReply: true });
    expect(newsletterUnsubscribePostRoute).toMatchObject({ method: "post", path: "/newsletter/unsubscribe", bufferedReply: true });
    expect(newsletterUnsubscribePostRoute.handle).toBe(newsletterUnsubscribeGetRoute.handle);
  });

  it("answers the same 200 page for an unsubscribe and for an already-unsubscribed repeat", async () => {
    const first = unsubscribeDeps();
    const repeat = unsubscribeDeps({ unsubscribe: async () => ({ outcome: "already-unsubscribed" }) });
    const a = await newsletterUnsubscribeGetRoute.handle({ raw: rawWith({ token: "tok" }), deps: first }, { signal });
    const b = await newsletterUnsubscribePostRoute.handle({ raw: rawWith({ token: "tok" }), deps: repeat }, { signal });
    expect(a.status).toBe(200);
    expect(a.headers.get("content-type")).toBe(HTML);
    const body = await a.text();
    expect(body).toContain("<h1>You&#39;re unsubscribed</h1>");
    expect(body).toContain("<p>You will no longer receive this newsletter. If this was a mistake, you can re-subscribe at any time.</p>");
    expect(await b.text()).toBe(body);
    expect(first.tokens).toEqual(["tok"]);
  });

  it("uses an empty token when the query token is not a string", async () => {
    const deps = unsubscribeDeps();
    await newsletterUnsubscribeGetRoute.handle({ raw: rawWith({ token: 5 }), deps }, { signal });
    expect(deps.tokens).toEqual([""]);
  });

  it("answers the 400 invalid-link page for an invalid unsubscribe token", async () => {
    const deps = unsubscribeDeps({ unsubscribe: async () => { throw new NewsletterUnsubscribeTokenInvalidError({ message: "bad", reason: "signature_invalid" }); } });
    const res = await newsletterUnsubscribeGetRoute.handle({ raw: rawWith({ token: "t" }), deps }, { signal });
    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).toContain("<h1>Unsubscribe link invalid</h1>");
    expect(body).toContain("<p>This unsubscribe link is invalid or has expired.</p>");
  });

  it("answers the 500 page with the reported error id for any other failure, and awaits readiness first", async () => {
    const order: string[] = [];
    const deps = unsubscribeDeps({
      ready: async () => { order.push("ready"); },
      unsubscribe: async () => { order.push("unsubscribe"); throw new Error("db down"); },
      reportFailure: () => ({ errorId: "ERR-7" }),
    });
    const res = await newsletterUnsubscribePostRoute.handle({ raw: rawWith({ token: "t" }), deps }, { signal });
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).toContain("<h1>Unsubscription unavailable</h1>");
    expect(body).toContain("Error ID: ERR-7</p>");
    expect(order).toEqual(["ready", "unsubscribe"]);
  });
});
