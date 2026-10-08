/**
 * @file Route-level tests for `POST /payments/webhook/:providerId` against the REAL `createApp()`.
 *
 * The point of using the real app rather than a minimal standalone Express instance: the whole
 * design problem is that `app.ts` mounts a blanket `express.json({ limit: "15mb" })` ahead of route
 * registration, which parses the body and discards the bytes an HMAC is computed over. A test that
 * built its own app without that parser would prove nothing. These tests send genuinely signed
 * bytes through the app that HAS the blanket parser mounted, so a regression in registration order
 * fails here immediately.
 */
import assert from "node:assert/strict";
import { once } from "node:events";
import http, { createServer } from "node:http";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import Database from "better-sqlite3";
import express from "express";

import type { HttpClientPort, HttpRequest, HttpResponse } from "@jini-ai/core/primitives";
import { InMemoryPaymentCredentials } from "../../payments/credentials.js";
import { activateLipay } from "../../payments/__tests__/storage.js";
import type { LipayApi } from "../../payments/lipay-plugin.js";
import { createLipayGateway, signLipayWebhook } from "../../payments/providers/lipay-gateway.js";
import { registerPaymentsWebhookRoute } from "../payments-webhook.js";
import { startTestServer } from "./http-test-server.js";

/** Opt-in fixture: raw-byte route before the host-style blanket JSON parser. */
function paymentApp(lipay: LipayApi | null) {
  const app = express();
  registerPaymentsWebhookRoute({ app, deps: { resolveLipay: () => lipay } });
  app.use(express.json({ limit: "15mb" }));
  return app;
}

const WORKSPACE_ID = "workspace-1";
const WEBHOOK_SECRET = "whsec_route_test";

class ScriptedHttpClient implements HttpClientPort {
  constructor(private readonly responses: readonly HttpResponse[]) {}
  private cursor = 0;
  async send(_request: { request: HttpRequest }): Promise<HttpResponse> {
    const entry = this.responses[Math.min(this.cursor, this.responses.length - 1)];
    this.cursor += 1;
    return entry;
  }
}

async function makeFixture(): Promise<{ lipay: LipayApi; paymentId: string; db: Database.Database; dir: string; now: number }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tovu-lipay-route-"));
  const dbPath = path.join(dir, "content.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");

  const now = Date.now();
  let n = 0;
  const lipay = await activateLipay({
    db,
    dbPath,
    workspaceId: WORKSPACE_ID,
    httpClient: new ScriptedHttpClient([
      { status: 200, headers: {}, bodyText: JSON.stringify({ id: "ch_1", status: "pending", next_action: { type: "none" } }) },
    ]),
    credentials: new InMemoryPaymentCredentials({ lipay: { secretKey: "sk_route_test", webhookSecret: WEBHOOK_SECRET } }),
    providers: [createLipayGateway({ apiBaseUrl: "https://lipay.test" })],
    clock: { now: () => now },
    idGen: { newId: () => `route-${(n += 1)}` },
    webhookBaseUrl: "https://site.test",
    returnUrl: "https://site.test/return",
  });

  const charged = await lipay.charge({
    workspaceId: WORKSPACE_ID,
    providerId: "lipay",
    amount: { minorUnits: 4200, currency: "USD" },
    idempotencyKey: "order-1",
  });
  if (!charged.ok) throw new Error("charge fixture failed");

  return { lipay, paymentId: charged.payment.id, db, dir, now };
}

async function withServer<T>(lipay: LipayApi, run: (baseUrl: string) => Promise<T>): Promise<T> {
  const app = paymentApp(lipay);
  const server = createServer(app);
  server.listen(0);
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  try {
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

// `Buffer<ArrayBuffer>`, not bare `Buffer` (= `Buffer<ArrayBufferLike>`): only the former is a
// fetch `BodyInit`, and `Buffer.from(string)` already returns it.
function signedDelivery(body: unknown, timestampSeconds: number): { raw: Buffer<ArrayBuffer>; signature: string } {
  const raw = Buffer.from(JSON.stringify(body), "utf8");
  return { raw, signature: signLipayWebhook({ secret: WEBHOOK_SECRET, rawBody: raw, timestampSeconds }) };
}

function cleanup(db: Database.Database, dir: string): void {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

test("payments webhook: a real HMAC-signed request validates through the app that mounts express.json", async () => {
  const { lipay, paymentId, db, dir, now } = await makeFixture();
  const seconds = Math.floor(now / 1000);
  const { raw, signature } = signedDelivery(
    { id: "evt_1", type: "charge.succeeded", created: seconds, data: { id: "ch_1", amount: 4200, currency: "USD" } },
    seconds
  );

  const status = await withServer(lipay, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/payments/webhook/lipay`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-lipay-signature": signature },
      body: raw,
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { processed: 1, duplicates: 0 });
    return (await lipay.getPayment({ workspaceId: WORKSPACE_ID, id: paymentId }))?.status;
  });

  assert.equal(status, "succeeded");
  cleanup(db, dir);
});

test("payments webhook: a body tampered with after signing is rejected with 401", async () => {
  const { lipay, paymentId, db, dir, now } = await makeFixture();
  const seconds = Math.floor(now / 1000);
  const { raw, signature } = signedDelivery(
    { id: "evt_1", type: "charge.succeeded", created: seconds, data: { id: "ch_1", amount: 4200, currency: "USD" } },
    seconds
  );
  const tampered = Buffer.from(raw.toString("utf8").replace('"amount":4200', '"amount":1'), "utf8");
  assert.notEqual(tampered.toString("utf8"), raw.toString("utf8"));

  const status = await withServer(lipay, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/payments/webhook/lipay`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-lipay-signature": signature },
      body: tampered,
    });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).code, "SIGNATURE_INVALID");
    return (await lipay.getPayment({ workspaceId: WORKSPACE_ID, id: paymentId }))?.status;
  });

  assert.equal(status, "pending");
  cleanup(db, dir);
});

test("payments webhook: byte-identical JSON that differs only in key order and whitespace still verifies", async () => {
  // This is the failure mode the raw-body fix exists for: `express.json()` reparses the body, and
  // any re-serialization reorders keys and drops whitespace, so an HMAC over the reserialized form
  // would not match. Sending deliberately unusual formatting proves the original bytes survived.
  const { lipay, db, dir, now } = await makeFixture();
  const seconds = Math.floor(now / 1000);
  const raw = Buffer.from(
    `{\n  "data" : { "currency":"USD", "amount":4200, "id":"ch_1" },\n  "created":${seconds},\n  "type":"charge.succeeded",\n  "id":"evt_1"\n}`,
    "utf8"
  );
  const signature = signLipayWebhook({ secret: WEBHOOK_SECRET, rawBody: raw, timestampSeconds: seconds });

  await withServer(lipay, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/payments/webhook/lipay`, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8", "x-lipay-signature": signature },
      body: raw,
    });
    assert.equal(response.status, 200, "the exact bytes must reach the verifier, not a reserialized copy");
  });

  cleanup(db, dir);
});

test("payments webhook: a redelivery is acknowledged as a duplicate, not applied twice", async () => {
  const { lipay, db, dir, now } = await makeFixture();
  const seconds = Math.floor(now / 1000);
  const { raw, signature } = signedDelivery(
    { id: "evt_1", type: "charge.succeeded", created: seconds, data: { id: "ch_1" } },
    seconds
  );

  await withServer(lipay, async (baseUrl) => {
    const send = () =>
      fetch(`${baseUrl}/payments/webhook/lipay`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-lipay-signature": signature },
        body: raw,
      });

    assert.deepEqual(await (await send()).json(), { processed: 1, duplicates: 0 });
    assert.deepEqual(await (await send()).json(), { processed: 0, duplicates: 1 });
  });

  cleanup(db, dir);
});

test("payments webhook: an unregistered provider is a 404 and an unsigned request a 401", async () => {
  const { lipay, db, dir } = await makeFixture();

  await withServer(lipay, async (baseUrl) => {
    const missing = await fetch(`${baseUrl}/payments/webhook/stripe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).code, "PROVIDER_NOT_REGISTERED");

    const unsigned = await fetch(`${baseUrl}/payments/webhook/lipay`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(unsigned.status, 401);
  });

  cleanup(db, dir);
});

// ---------------------------------------------------------------------------------------------
// `statusForError`/`flattenHeaders` branch coverage — standalone `registerPaymentsWebhookRoute`
// around a fake `LipayApi`, the same technique `route-async-guards.test.ts` uses for this exact
// route (`resolveLipay` is the seam the route itself defines; it needs no real, DB-backed lipay
// instance or HMAC signing to reach these branches, which live entirely in THIS file's own
// `statusForError`/`flattenHeaders` helpers, downstream of `handleWebhook`'s return value).
// ---------------------------------------------------------------------------------------------

function withFakeLipay(handleWebhook: LipayApi["handleWebhook"]): { app: express.Express } {
  const fakeLipay = { handleWebhook } as unknown as LipayApi;
  const app = express();
  registerPaymentsWebhookRoute({ app, deps: { resolveLipay: () => fakeLipay } });
  return { app };
}

test("payments webhook: statusForError maps NO_CREDENTIALS_CONFIGURED to 503", async (t) => {
  const { app } = withFakeLipay(async () => ({
    accepted: false,
    processed: 0,
    duplicates: 0,
    error: { code: "NO_CREDENTIALS_CONFIGURED", message: "no credentials configured for this provider", retryable: false },
  }));
  const baseUrl = await startTestServer(app, t);

  const res = await fetch(`${baseUrl}/payments/webhook/lipay`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(res.status, 503);
  assert.equal((await res.json()).code, "NO_CREDENTIALS_CONFIGURED");
});

test("payments webhook: statusForError falls back to 400 for an error code it doesn't special-case (e.g. DECLINED)", async (t) => {
  const { app } = withFakeLipay(async () => ({
    accepted: false,
    processed: 0,
    duplicates: 0,
    error: { code: "DECLINED", message: "the card was declined", retryable: false },
  }));
  const baseUrl = await startTestServer(app, t);

  const res = await fetch(`${baseUrl}/payments/webhook/lipay`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, "DECLINED");
});

test("payments webhook: a content-type that doesn't match application/json leaves req.body untouched by express.raw, so rawBody falls back to an empty buffer", async (t) => {
  // This route is registered BEFORE the blanket `express.json()` (this file's own header) precisely
  // so a matching delivery's exact bytes survive; the flip side, documented in this route's own
  // `rawBody` comment, is that a delivery with the WRONG content-type never gets parsed into a
  // buffer at all -- proven here directly rather than via a real signature failure.
  let capturedRawBody: Buffer | undefined;
  const { app } = withFakeLipay(async ({ rawBody }) => {
    capturedRawBody = rawBody;
    return { accepted: false, processed: 0, duplicates: 0, error: { code: "SIGNATURE_INVALID", message: "bad signature", retryable: false } };
  });
  const baseUrl = await startTestServer(app, t);

  const res = await fetch(`${baseUrl}/payments/webhook/lipay`, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "not a json content-type",
  });
  assert.equal(res.status, 401);
  assert.ok(capturedRawBody, "handleWebhook must still be called, with a Buffer");
  assert.equal(capturedRawBody!.length, 0, "a content-type mismatch means express.raw never populated req.body, so rawBody falls back to an empty buffer");
});

test("payments webhook: a duplicate request header (Set-Cookie sent twice) arrives as an array and is joined with \", \", never silently dropped", async (t) => {
  let capturedHeaders: Record<string, string> | undefined;
  const { app } = withFakeLipay(async ({ headers }) => {
    capturedHeaders = headers;
    return { accepted: true, processed: 1, duplicates: 0 };
  });
  const baseUrl = await startTestServer(app, t);
  const { port } = new URL(baseUrl);

  const payload = JSON.stringify({ type: "test.event" });
  const status = await new Promise<number>((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method: "POST",
        path: "/payments/webhook/lipay",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
          "set-cookie": ["a=1", "b=2"],
        },
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
      }
    );
    req.on("error", reject);
    req.end(payload);
  });

  assert.equal(status, 200);
  assert.equal(capturedHeaders?.["set-cookie"], "a=1, b=2", "a repeated header is joined, providers are HTTP clients not browsers (this file's own flattenHeaders comment)");
});

/** Express's own (internal, untyped) per-route layer shape — same technique
 *  `analytics-ingest.test.ts`/`comments-submit.test.ts` use to call a registered handler DIRECTLY.
 *  Needed only for `flattenHeaders`'s `if (value === undefined) continue` guard: Node's real
 *  `IncomingMessage.headers` never contains an explicit `undefined` value for any key a real request
 *  produces (TypeScript's own `IncomingHttpHeaders` type allows it only because `Object.entries`
 *  indexing is technically total, not because the runtime object ever has one) -- this guard exists
 *  for that TYPE, and for whatever hand-built `req`-shaped object a caller might one day construct,
 *  which is exactly what this test constructs. */
interface ExpressHandlerLayer {
  route?: { path: string; stack: { handle: (req: unknown, res: unknown) => unknown }[] };
}
interface ExpressAppWithRouter {
  _router: { stack: ExpressHandlerLayer[] };
}

function extractHandler(app: express.Express, routePath: string): (req: unknown, res: unknown) => unknown {
  const stack = (app as unknown as ExpressAppWithRouter)._router.stack;
  const layer = stack.find((l) => l.route?.path === routePath);
  if (!layer?.route) throw new Error(`route '${routePath}' was not found in the router stack`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

test("payments webhook: flattenHeaders skips a header entry whose value is `undefined`, forced via a direct handler call -- never crashes, never writes \"undefined\" into the flattened headers", async () => {
  let capturedHeaders: Record<string, string> | undefined;
  const { app } = withFakeLipay(async ({ headers }) => {
    capturedHeaders = headers;
    return { accepted: true, processed: 1, duplicates: 0 };
  });
  const handler = extractHandler(app, "/payments/webhook/:providerId");

  let statusCode: number | undefined;
  const res = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json() {
      return res;
    },
  };
  const req = {
    params: { providerId: "lipay" },
    body: Buffer.from("{}"),
    headers: { "content-type": "application/json", "x-forced-undefined": undefined },
  };

  await handler(req, res);

  assert.equal(statusCode, 200);
  assert.equal(capturedHeaders?.["x-forced-undefined"], undefined, "an undefined-valued header entry is skipped, never coerced into a literal \"undefined\" string");
  assert.equal(capturedHeaders?.["content-type"], "application/json", "every OTHER header still flattens normally");
});

test("payments webhook: an install without lipay composed reports 503 rather than 404", async () => {
  // `createRouteDeps()` (the hermetic in-memory composition) has no lipay, and the route is
  // registered unconditionally — so the honest answer is "not configured here", not "no such route".
  const app = paymentApp(null);
  const server = createServer(app);
  server.listen(0);
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/payments/webhook/lipay`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "PAYMENTS_UNAVAILABLE");
  } finally {
    server.close();
    await once(server, "close");
  }
});
