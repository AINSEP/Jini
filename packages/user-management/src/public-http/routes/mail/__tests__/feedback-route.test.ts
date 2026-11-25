import { createHmac, timingSafeEqual } from "node:crypto";
import type { RouteInputContext } from "@jini-ai/core/contracts/server";
import { describe, expect, it } from "vitest";
import { mailFeedbackRoute, type MailFeedbackHeaders, type MailFeedbackRouteDeps } from "../feedback.js";

const signal = new AbortController().signal;
const SECRET = "whsec-test";
const JSON_TYPE = "application/json; charset=utf-8";
const sign = (bytes: Uint8Array) => createHmac("sha256", SECRET).update(bytes).digest("hex");
const rawWith = (body: unknown, providerId = "resend"): RouteInputContext => ({ params: { providerId }, query: {}, body }) as RouteInputContext;

type Seen = { providerId: string; rawBody: Uint8Array; headers: MailFeedbackHeaders };

/** A stand-in ingest that verifies an HMAC over the exact bytes it is handed, the way a provider parser does. */
function ingestDeps(requestHeaders: MailFeedbackHeaders, maxBodyBytes = 64): MailFeedbackRouteDeps & { seen: Seen[] } {
  const seen: Seen[] = [];
  return {
    seen, requestHeaders,
    ingest: {
      async handle(input) {
        seen.push(input);
        if (input.providerId !== "resend") return { status: 404, body: { ok: false } };
        if (input.rawBody.byteLength > maxBodyBytes) return { status: 413, body: { ok: false } };
        const given = input.headers["x-signature"];
        if (typeof given !== "string") return { status: 401, body: { ok: false } };
        const expected = Buffer.from(sign(input.rawBody));
        const actual = Buffer.from(given);
        if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return { status: 401, body: { ok: false } };
        return { status: 200, body: { ok: true } };
      },
    },
  };
}

const bytes = (text: string) => Buffer.from(text, "utf8");

describe("mailFeedbackRoute", () => {
  it("is a buffered POST on the provider webhook path", () => {
    expect(mailFeedbackRoute).toMatchObject({ method: "post", path: "/hooks/mail/:providerId", bufferedReply: true });
  });

  it("hands the ingest the exact request bytes, provider id and the request's own headers, and answers its JSON", async () => {
    const body = bytes('{ "type":  "email.bounced" }');
    const headers = { "x-signature": sign(body), "x-repeat": ["a", "b"] };
    const deps = ingestDeps(headers);
    const res = await mailFeedbackRoute.handle({ raw: rawWith(body), deps }, { signal });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(JSON_TYPE);
    expect(await res.text()).toBe('{"ok":true}');
    const [seen] = deps.seen;
    expect(seen!.providerId).toBe("resend");
    expect(Buffer.from(seen!.rawBody).toString("utf8")).toBe('{ "type":  "email.bounced" }');
    expect(seen!.headers).toBe(headers);
  });

  it("refuses a forged signature with the ingest's 401", async () => {
    const body = bytes('{"type":"email.bounced"}');
    const deps = ingestDeps({ "x-signature": sign(bytes('{"type":"email.delivered"}')) });
    const res = await mailFeedbackRoute.handle({ raw: rawWith(body), deps }, { signal });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false });
  });

  it("refuses a request with no signature", async () => {
    const res = await mailFeedbackRoute.handle({ raw: rawWith(bytes("{}")), deps: ingestDeps({}) }, { signal });
    expect(res.status).toBe(401);
  });

  it("answers an unknown provider with the ingest's 404", async () => {
    const body = bytes("{}");
    const res = await mailFeedbackRoute.handle({ raw: rawWith(body, "nope"), deps: ingestDeps({ "x-signature": sign(body) }) }, { signal });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false });
  });

  it("answers an oversized body with the ingest's 413", async () => {
    const body = bytes("x".repeat(100));
    const res = await mailFeedbackRoute.handle({ raw: rawWith(body), deps: ingestDeps({ "x-signature": sign(body) }, 8) }, { signal });
    expect(res.status).toBe(413);
  });

  it.each([[{}], [undefined]])("a request with no parsed body (%o) reaches the ingest as empty bytes", async (body) => {
    const deps = ingestDeps({ "x-signature": sign(new Uint8Array(0)) });
    const res = await mailFeedbackRoute.handle({ raw: rawWith(body), deps }, { signal });
    expect(res.status).toBe(200);
    expect(deps.seen[0]!.rawBody.byteLength).toBe(0);
  });

  it("lets an ingest failure propagate to the host's failure writer", async () => {
    const deps = ingestDeps({});
    deps.ingest.handle = async () => { throw new Error("store failed"); };
    await expect(mailFeedbackRoute.handle({ raw: rawWith(bytes("{}")), deps }, { signal })).rejects.toThrow("store failed");
  });
});
