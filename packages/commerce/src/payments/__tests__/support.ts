/**
 * @file Shared fixtures for the lipay suite. `FakeHttpClient` mirrors
 * `deploy/__tests__/deploy-plugin.test.ts`'s local fake — never a real network call.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";

import type { HttpClientPort, HttpRequest, HttpResponse } from "@jini-ai/core/primitives";
import type { LipayApi } from "../lipay-plugin.js";
import { activateLipay } from "./storage.js";
import { createLipayGateway } from "../providers/lipay-gateway.js";
import { InMemoryPaymentCredentials } from "../credentials.js";
import type { PaymentProvider } from "../ports.js";

export const WORKSPACE_ID = "workspace-1";
export const API_BASE = "https://lipay.test";
export const WEBHOOK_SECRET = "whsec_test_do_not_use_in_prod";
export const SECRET_KEY = "sk_test_do_not_use_in_prod";

type ScriptedResponse = HttpResponse | (() => HttpResponse);

export class FakeHttpClient implements HttpClientPort {
  readonly calls: HttpRequest[] = [];
  private readonly responses: readonly ScriptedResponse[];
  private cursor = 0;

  constructor(responses: readonly ScriptedResponse[] = [{ status: 200, headers: {}, bodyText: "{}" }]) {
    this.responses = responses;
  }

  async send({ request }: { request: HttpRequest }): Promise<HttpResponse> {
    this.calls.push(request);
    const entry = this.responses[this.cursor];
    this.cursor += 1;
    if (entry === undefined) throw new Error(`unexpected provider request: ${request.method} ${request.url} (script exhausted)`);
    if (typeof entry === "function") return entry();
    return entry;
  }
}

/** Advanceable so ordering, timestamps and signature skew are asserted, not guessed. */
export class TestClock {
  constructor(private current: number) {}
  now(): number {
    return this.current;
  }
  advance(ms: number): void {
    this.current += ms;
  }
  set(ms: number): void {
    this.current = ms;
  }
}

export function testIdGen(prefix = "id"): { newId(): string } {
  let n = 0;
  return {
    newId(): string {
      n += 1;
      return `${prefix}-${n}`;
    },
  };
}

export function tempDb(): { db: Database.Database; dbPath: string; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tovu-lipay-"));
  const dbPath = path.join(dir, "content.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  return { db, dbPath, dir };
}

export function cleanup(db: Database.Database, dir: string): void {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

export interface Harness {
  api: LipayApi;
  db: Database.Database;
  dir: string;
  http: FakeHttpClient;
  clock: TestClock;
  credentials: InMemoryPaymentCredentials;
}

/** A fully wired lipay against a real SQLite file, with the real first-party gateway registered. */
export async function makeLipay(
  options: {
    responses?: readonly ScriptedResponse[];
    providers?: readonly PaymentProvider[];
    credentials?: InMemoryPaymentCredentials;
    startAt?: number;
  } = {}
): Promise<Harness> {
  const { db, dbPath, dir } = tempDb();
  const http = new FakeHttpClient(options.responses ?? [{ status: 200, headers: {}, bodyText: "{}" }]);
  const clock = new TestClock(options.startAt ?? Date.UTC(2026, 6, 30, 12, 0, 0));
  const credentials =
    options.credentials ??
    new InMemoryPaymentCredentials({ lipay: { secretKey: SECRET_KEY, webhookSecret: WEBHOOK_SECRET } });

  const api = await activateLipay({
    db,
    dbPath,
    workspaceId: WORKSPACE_ID,
    httpClient: http,
    credentials,
    providers: options.providers ?? [createLipayGateway({ apiBaseUrl: API_BASE })],
    clock,
    idGen: testIdGen("pay"),
    webhookBaseUrl: "https://site.test",
    returnUrl: "https://site.test/checkout/return",
  });

  return { api, db, dir, http, clock, credentials };
}

export const chargeOk = (id: string, status: "succeeded" | "pending" = "pending"): HttpResponse => ({
  status: 200,
  headers: {},
  bodyText: JSON.stringify({
    id,
    status,
    next_action: status === "pending" ? { type: "redirect", url: `${API_BASE}/checkout/${id}` } : { type: "none" },
  }),
});

export const refundOk = (id: string): HttpResponse => ({
  status: 200,
  headers: {},
  bodyText: JSON.stringify({ id, status: "succeeded" }),
});
