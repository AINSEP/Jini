import { once } from "node:events";
import http, { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import express from "express";
import { afterEach, describe, expect, test } from "vitest";

import type { ResolvedEndpoint, WebhookReceiver, WebhookResponse } from "../../payments/ingest/receive.js";
import { ingestWorld } from "../../payments/ingest/__tests__/harness.js";
import { registerPaymentsWebhookRoute, type PaymentsWebhookDeps } from "../index.js";

/**
 * @file Route tests for `POST <prefix>/payments/webhooks/:siteId/:providerId/:endpointId` on a REAL
 * express app over a real socket. The app mounts a host-style blanket `express.json` AFTER the
 * route, as a host does: the whole design problem is that such a parser discards the bytes an
 * HMAC is computed over, so genuinely signed bytes must still verify through it.
 */

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
});

async function listen(app: express.Express): Promise<string> {
  const server = createServer(app);
  servers.push(server);
  server.listen(0);
  await once(server, "listening");
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function appWith(deps: PaymentsWebhookDeps, optional: { prefix?: string; limit?: string; parserFirst?: boolean } = {}) {
  const app = express();
  if (optional.parserFirst) app.use(express.json());
  registerPaymentsWebhookRoute({ app, deps }, optional);
  app.use(express.json({ limit: "15mb" }));
  return app;
}

/** Raw request so duplicate header lines and exact bytes are under the test's control. */
function post(url: string, optional: { body?: Uint8Array | string; headers?: http.OutgoingHttpHeaders } = {}): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: "POST", headers: optional.headers ?? {} }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({ status: res.statusCode ?? 0, body: text.startsWith("{") ? JSON.parse(text) : text });
      });
    });
    req.on("error", reject);
    if (optional.body !== undefined) req.write(optional.body);
    req.end();
  });
}

const URL_PATH = "/payments/webhooks/site/lipay/ep1";

async function signedWorld() {
  const w = await ingestWorld();
  await w.insertPayment();
  await w.charge();
  const app = appWith({ resolveReceiver: () => w.receiver });
  return { w, base: await listen(app) };
}

/** A receiver fake: resolves every endpoint, records what reached `receive`. */
function recordingReceiver(optional: { receive?: WebhookReceiver["receive"]; resolveEndpoint?: WebhookReceiver["resolveEndpoint"] } = {}) {
  const calls: { rawBody: Uint8Array; headers: Readonly<Record<string, string>> }[] = [];
  const endpoint = {} as ResolvedEndpoint;
  const ok: WebhookResponse = { status: 200, body: { received: 1, duplicates: 0 } };
  const receiver: WebhookReceiver = {
    resolveEndpoint: optional.resolveEndpoint ?? (async () => ({ ok: true, endpoint })),
    receive: optional.receive ?? (async ({ rawBody, headers }) => { calls.push({ rawBody, headers }); return ok; }),
  };
  return { receiver, calls };
}

describe("payments webhook route", () => {
  test("receiver activation and removal take effect on the next request without registering the route again", async () => {
    const { receiver, calls } = recordingReceiver();
    let active: WebhookReceiver | null = null;
    const app = express();
    registerPaymentsWebhookRoute({ app, deps: { resolveReceiver: () => active } });
    app.use(express.json());
    const base = await listen(app);
    expect(await post(base + URL_PATH)).toEqual({ status: 503, body: { code: "PAYMENTS_UNAVAILABLE", message: "payments are not configured on this install" } });
    active = receiver;
    expect(await post(base + URL_PATH, { body: "exact bytes" })).toEqual({ status: 200, body: { received: 1, duplicates: 0 } });
    expect(calls.map(call => Buffer.from(call.rawBody).toString("utf8"))).toEqual(["exact bytes"]);
    active = null;
    expect(await post(base + URL_PATH)).toEqual({ status: 503, body: { code: "PAYMENTS_UNAVAILABLE", message: "payments are not configured on this install" } });
    expect(calls).toHaveLength(1);
  });

  test("endpoint resolution receives decoded URL identity and its refusal bypasses receive even for an oversized body", async () => {
    const paths: unknown[] = [];
    let received = false;
    const receiver: WebhookReceiver = {
      resolveEndpoint: async input => {
        paths.push(input);
        return { ok: false, response: { status: 404, body: { code: "ENDPOINT_NOT_FOUND", message: "no such webhook endpoint" } } };
      },
      receive: async () => { received = true; return { status: 200, body: { received: 1, duplicates: 0 } }; },
    };
    const base = await listen(appWith({ resolveReceiver: () => receiver }, { prefix: "/api", limit: "1b" }));
    expect(await post(`${base}/api/payments/webhooks/site%20one/provider-two/endpoint-three`, { body: "oversized" })).toEqual({
      status: 404, body: { code: "ENDPOINT_NOT_FOUND", message: "no such webhook endpoint" },
    });
    expect(paths).toEqual([{ path: { siteId: "site one", providerId: "provider-two", endpointId: "endpoint-three" } }]);
    expect(received).toBe(false);
  });

  test.each([400, 500, 503] as const)("the receiver's %s response is forwarded without changing its retry semantics", async status => {
    const response: WebhookResponse = { status, body: { code: "RECEIVER_RESULT", message: "public error" } };
    const { receiver } = recordingReceiver({ receive: async () => response });
    const base = await listen(appWith({ resolveReceiver: () => receiver }));
    expect(await post(base + URL_PATH, { body: "{}" })).toEqual(response);
  });

  test("a binary body is delivered without decoding, normalization or JSON serialization", async () => {
    const { receiver, calls } = recordingReceiver();
    const base = await listen(appWith({ resolveReceiver: () => receiver }));
    const bytes = Buffer.from([0, 255, 128, 13, 10, 32, 123, 125]);
    expect(await post(base + URL_PATH, { body: bytes, headers: { "content-type": "application/octet-stream" } }))
      .toEqual({ status: 200, body: { received: 1, duplicates: 0 } });
    expect(calls).toHaveLength(1);
    expect(Buffer.from(calls[0]!.rawBody)).toEqual(bytes);
    expect(calls[0]!.headers["content-type"]).toBe("application/octet-stream");
  });

  test("the body limit accepts the exact bound and refuses one additional byte before receive", async () => {
    const { receiver, calls } = recordingReceiver();
    const base = await listen(appWith({ resolveReceiver: () => receiver }, { limit: "3b" }));
    expect(await post(base + URL_PATH, { body: "123" })).toEqual({ status: 200, body: { received: 1, duplicates: 0 } });
    expect((await post(base + URL_PATH, { body: "1234" })).status).toBe(413);
    expect(calls.map(call => Buffer.from(call.rawBody).toString("utf8"))).toEqual(["123"]);
  });

  test("a non-Error rejection produces the same fixed 500 without leaking provider text", async () => {
    const { receiver } = recordingReceiver({ receive: async () => { throw "secret webhook credential"; } });
    const base = await listen(appWith({ resolveReceiver: () => receiver }));
    expect(await post(base + URL_PATH, { body: "{}" })).toEqual({ status: 500, body: { code: "INTERNAL_ERROR", message: "internal error" } });
  });

  test("a real signed delivery verifies through an app that mounts express.json, and is recorded (not applied)", async () => {
    const { w, base } = await signedWorld();
    const { rawBody, headers } = w.fake.server.webhook({ type: "charge.succeeded", id: "ch_1", eventId: "evt_1" });
    const res = await post(base + URL_PATH, { body: rawBody, headers: { ...headers, "content-type": "application/json" } });
    expect(res).toEqual({ status: 200, body: { received: 1, duplicates: 0 } });
    expect(await w.tx((t) => t.listDueInbox({ now: w.now(), limit: 10 }))).toHaveLength(1);
    expect((await w.read()).payment.intentStatus).toBe("unknown");
    const again = await post(base + URL_PATH, { body: rawBody, headers: { ...headers, "content-type": "application/json" } });
    expect(again).toEqual({ status: 200, body: { received: 0, duplicates: 1 } });
  });

  test("any content type is read as raw bytes: a provider signs what it sent, whatever it labels it", async () => {
    const { w, base } = await signedWorld();
    const { rawBody, headers } = w.fake.server.webhook({ type: "charge.succeeded", id: "ch_1", eventId: "evt_1" });
    const res = await post(base + URL_PATH, { body: rawBody, headers: { ...headers, "content-type": "text/plain" } });
    expect(res.status).toBe(200);
  });

  test("a body tampered with after signing is a 400 SIGNATURE_INVALID", async () => {
    const { w, base } = await signedWorld();
    const { rawBody, headers } = w.fake.server.webhook({ type: "charge.succeeded", id: "ch_1", eventId: "evt_1" });
    const tampered = Buffer.from(rawBody).toString("utf8").replace("{", "{ ");
    const res = await post(base + URL_PATH, { body: tampered, headers: { ...headers, "content-type": "application/json" } });
    expect(res).toEqual({ status: 400, body: { code: "SIGNATURE_INVALID", message: "webhook rejected" } });
  });

  test("a host parser mounted AHEAD of the route by mistake leaves no raw bytes: verification fails closed (400), never 2xx", async () => {
    const w = await ingestWorld();
    const base = await listen(appWith({ resolveReceiver: () => w.receiver }, { parserFirst: true }));
    const { rawBody, headers } = w.fake.server.webhook({ type: "charge.succeeded", id: "ch_1", eventId: "evt_1" });
    const res = await post(base + URL_PATH, { body: rawBody, headers: { ...headers, "content-type": "application/json" } });
    expect(res.status).toBe(400);
  });

  test("an unknown endpoint is a 404 answered BEFORE the body is read (an oversized body would otherwise be a 413)", async () => {
    const w = await ingestWorld();
    const base = await listen(appWith({ resolveReceiver: () => w.receiver }, { limit: "10b" }));
    const big = "x".repeat(1_000);
    expect(await post(`${base}/payments/webhooks/site/lipay/unknown`, { body: big })).toEqual({ status: 404, body: { code: "ENDPOINT_NOT_FOUND", message: "no such webhook endpoint" } });
    expect((await post(base + URL_PATH, { body: big })).status).toBe(413);
  });

  test("the URL's provider must match the endpoint's: another provider id on a known endpoint is a 404", async () => {
    const w = await ingestWorld();
    const base = await listen(appWith({ resolveReceiver: () => w.receiver }));
    expect((await post(`${base}/payments/webhooks/site/stripe/ep1`, { body: "{}" })).status).toBe(404);
  });

  test("an install without payments composed reports 503 rather than 404", async () => {
    const base = await listen(appWith({ resolveReceiver: () => null }));
    expect(await post(base + URL_PATH, { body: "{}" })).toEqual({ status: 503, body: { code: "PAYMENTS_UNAVAILABLE", message: "payments are not configured on this install" } });
  });

  test("the prefix option mounts the route under the host's path", async () => {
    const { receiver } = recordingReceiver();
    const base = await listen(appWith({ resolveReceiver: () => receiver }, { prefix: "/api" }));
    expect((await post(`${base}/api${URL_PATH}`, { body: "{}" })).status).toBe(200);
    expect((await post(base + URL_PATH, { body: "{}" })).status).toBe(404);
  });

  test("headers reach the receiver lowercased, with a repeated header joined by ', ' (never dropped); the body as exact bytes", async () => {
    const { receiver, calls } = recordingReceiver();
    const base = await listen(appWith({ resolveReceiver: () => receiver }));
    await post(base + URL_PATH, { body: '{"b":1, "a":2}', headers: { "X-Signature": ["v1=aaa", "v1=bbb"], "content-type": "application/json" } });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.headers["x-signature"]).toBe("v1=aaa, v1=bbb");
    expect(calls[0]!.headers["content-type"]).toBe("application/json");
    expect(Buffer.from(calls[0]!.rawBody).toString("utf8")).toBe('{"b":1, "a":2}');
  });

  test("a POST with no body reaches the receiver as empty bytes", async () => {
    const { receiver, calls } = recordingReceiver();
    const base = await listen(appWith({ resolveReceiver: () => receiver }));
    await post(base + URL_PATH);
    expect(calls.map((c) => c.rawBody.length)).toEqual([0]);
  });

  test.each([
    ["resolving the receiver", (): PaymentsWebhookDeps => ({ resolveReceiver: () => { throw new Error("sk_live leaked"); } })],
    ["resolving the endpoint", (): PaymentsWebhookDeps => {
      const { receiver } = recordingReceiver({ resolveEndpoint: async () => { throw new Error("sk_live leaked"); } });
      return { resolveReceiver: () => receiver };
    }],
    ["receiving", (): PaymentsWebhookDeps => {
      const { receiver } = recordingReceiver({ receive: async () => { throw new Error("sk_live leaked"); } });
      return { resolveReceiver: () => receiver };
    }],
  ])("a throw while %s is a fixed 500 (the provider retries) that leaks nothing", async (_label, deps) => {
    const base = await listen(appWith(deps()));
    expect(await post(base + URL_PATH, { body: "{}" })).toEqual({ status: 500, body: { code: "INTERNAL_ERROR", message: "internal error" } });
  });
});
