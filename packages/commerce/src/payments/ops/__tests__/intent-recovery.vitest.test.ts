import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { sql } from "kysely";
import { openPostgresKernel } from "@jini-ai/db/kernel/postgres";
import { openSqliteFileKernel } from "@jini-ai/db/kernel/sqlite";
import { migrateCommercePayments, sqlPaymentsLedger } from "../../ledger/sql.js";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { LedgerTx, PaymentsLedger } from "../../ledger/repo.js";
import { createPaymentsOperator } from "../service.js";
import { SCRIPTED, USD, timedOut, world, type WorldOptions } from "./harness.js";

const AGE = 60_000;
const request = { scope: SCRIPTED, amount: USD(10_000), idempotencyKey: "recover-order", reference: "order-1" };
const line = { description: "One item", quantity: 2, unitAmount: USD(5_000) };

type RecoveryKind = "memory" | "sqlite" | "postgres";
const pgCleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of pgCleanups.splice(0)) await cleanup(); });

/** PostgreSQL fixtures own isolated schemas and never drop another test's ledger. */
async function recoveryWorld(ledgerKind: RecoveryKind, options: Pick<WorldOptions, "wrapLedger"> = {}) {
  if (ledgerKind !== "postgres") return world({ ledgerKind, ...options });
  const pg = createRequire(new URL("../../../../node_modules/@jini-ai/db/package.json", import.meta.url))("pg");
  const connectionString = process.env.COMMERCE_PG_URL!;
  const admin = openPostgresKernel<unknown>({ pg, connectionString });
  const schema = `commerce_recovery_${randomUUID().replaceAll("-", "")}`;
  await admin.execute(sql`CREATE SCHEMA ${sql.id(schema)}`);
  const url = new URL(connectionString); url.searchParams.set("options", `-csearch_path=${schema}`);
  const kernel = openPostgresKernel<unknown>({ pg, connectionString: url.toString() });
  pgCleanups.push(async () => {
    await kernel.close();
    try { await admin.execute(sql`DROP SCHEMA ${sql.id(schema)} CASCADE`); } finally { await admin.close(); }
  });
  await migrateCommercePayments({ kernel });
  const ledger = sqlPaymentsLedger({ kernel });
  return world({ wrapLedger: () => options.wrapLedger ? options.wrapLedger(ledger) : ledger });
}

async function unknown(ledgerKind: RecoveryKind) {
  const w = await recoveryWorld(ledgerKind);
  Object.assign(w.scripted.provider, { intentReplayWindowMs: 23 * 60 * 60 * 1_000 });
  w.scripted.queue("createIntent", timedOut());
  const first = await w.service.createIntent(request, { line });
  if (first.ok || !first.payment) throw new Error("expected unknown payment");
  w.tick(AGE * 2);
  return { w, payment: first.payment };
}

const kinds: RecoveryKind[] = process.env.COMMERCE_PG_URL ? ["memory", "sqlite", "postgres"] : ["memory", "sqlite"];
for (const ledgerKind of kinds) describe(`intent recovery ${ledgerKind}`, () => {
  test("restart recovers the durable original request with the same charge key", async () => {
    const { w, payment } = await unknown(ledgerKind);
    const before = await w.read(payment.id);
    expect(before.attempts[0]).toMatchObject({ recoveryAttempts: 0 });
    const snapshot = JSON.parse(before.attempts[0]!.dispatchJson!);
    expect(snapshot.req).toMatchObject({ line, correlationId: payment.id, idempotencyKey: before.attempts[0]!.id });
    expect(JSON.stringify(snapshot)).not.toContain("credentials");
    const restarted = createPaymentsOperator(w.deps);
    expect((await restarted.reconcileUnknown({ olderThanMs: AGE, limit: 10 })).payments)
      .toEqual({ scanned: 1, settled: 1, failed: 0, left: 0, errors: 0 });
    const calls = w.scripted.calls.filter(call => call.op === "createIntent");
    expect(calls).toHaveLength(2);
    expect(calls[1]!.req).toEqual(calls[0]!.req);
    const after = await w.read(payment.id);
    expect(after.payment).toMatchObject({ status: "succeeded" });
    expect(after.attempts[0]).toMatchObject({ recoveryAttempts: 1, outcome: "ok" });
    expect(after.outbox).toEqual(["payment.succeeded"]);
  });

  test("concurrent reconcilers claim a single replay while the provider is in flight", async () => {
    const { w } = await unknown(ledgerKind);
    const original = w.scripted.provider.createIntent;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let started!: () => void;
    const began = new Promise<void>(resolve => { started = resolve; });
    const replay = vi.spyOn(w.scripted.provider, "createIntent").mockImplementation(async args => {
      started(); await gate; return original(args);
    });
    const first = w.operator.reconcileUnknown({ olderThanMs: AGE, limit: 10 });
    await began;
    const second = await createPaymentsOperator(w.deps).reconcileUnknown({ olderThanMs: AGE, limit: 10 });
    expect(second.payments.settled).toBe(0);
    release(); await first;
    expect(replay).toHaveBeenCalledTimes(1);
  });

  test("stops after three spaced recovery attempts and keeps unknown money unresolved", async () => {
    const { w, payment } = await unknown(ledgerKind);
    w.scripted.queue("createIntent", timedOut(), timedOut(), timedOut(), timedOut());
    for (let i = 0; i < 5; i++) {
      await w.operator.reconcileUnknown({ olderThanMs: AGE, limit: 10 });
      w.tick(23 * 60 * AGE / 3);
    }
    expect(w.scripted.calls.filter(call => call.op === "createIntent")).toHaveLength(4);
    expect((await w.read(payment.id)).attempts[0]).toMatchObject({ recoveryAttempts: 3, outcome: "unknown" });
    expect((await w.read(payment.id)).payment).toMatchObject({ status: "unknown", providerRef: null });
  });

  test("does not spend the recovery budget in minutes; retries span the provider retention window", async () => {
    const { w, payment } = await unknown(ledgerKind);
    const windowMs = 23 * 60 * AGE;
    w.scripted.queue("createIntent", timedOut(), timedOut(), timedOut());
    await w.operator.reconcileUnknown({ olderThanMs: AGE, limit: 10 });
    for (let minute = 0; minute < 5; minute++) {
      w.tick(AGE * 2);
      await createPaymentsOperator(w.deps).reconcileUnknown({ olderThanMs: AGE, limit: 10 });
    }
    expect(w.scripted.calls.filter(call => call.op === "createIntent")).toHaveLength(2);
    expect((await w.read(payment.id)).attempts[0]?.recoveryAttempts).toBe(1);
    w.tick(windowMs / 3);
    await w.operator.reconcileUnknown({ olderThanMs: AGE, limit: 10 });
    expect((await w.read(payment.id)).attempts[0]?.recoveryAttempts).toBe(2);
    w.tick(windowMs / 3);
    await createPaymentsOperator(w.deps).reconcileUnknown({ olderThanMs: AGE, limit: 10 });
    expect((await w.read(payment.id)).attempts[0]?.recoveryAttempts).toBe(3);
    w.tick(windowMs / 3);
    await w.operator.reconcileUnknown({ olderThanMs: AGE, limit: 10 });
    expect(w.scripted.calls.filter(call => call.op === "createIntent")).toHaveLength(4);
    expect((await w.read(payment.id)).payment).toMatchObject({ intentStatus: "unknown", providerRef: null, capturedMinor: 0 });
  });

  test("expired reference-less ambiguity stays unknown until an audited owner resolution", async () => {
    const { w, payment } = await unknown(ledgerKind);
    w.tick(24 * 60 * AGE);
    await w.operator.reconcileUnknown({ olderThanMs: AGE, limit: 10 });
    expect((await w.read(payment.id)).payment?.intentStatus).toBe("unknown");
    expect(await w.operator.resolveUnknown({ scope: SCRIPTED, paymentId: payment.id, outcome: "failed", actor: "owner", reason: "Verified provider dashboard: no completed payment" }))
      .toMatchObject({ ok: true, payment: { status: "failed" } });
    const after = await w.read(payment.id);
    expect(after.actions).toEqual([expect.objectContaining({ actor: "owner", outcome: "failed", reason: "Verified provider dashboard: no completed payment" })]);
    expect(await w.ledger.transaction({ fn: tx => tx.hasOpenPayment({ workspaceId: SCRIPTED.workspaceId }) })).toBe(false);
    expect(w.scripted.calls.filter(call => call.op === "createIntent")).toHaveLength(1);
  });

  test("changed amount conflicts before recovery and expired provider keys are never replayed", async () => {
    const { w } = await unknown(ledgerKind);
    expect(await w.service.createIntent({ ...request, amount: USD(20_000) }, { line: { ...line, quantity: 4 } }))
      .toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
    w.tick(24 * 60 * 60 * 1_000);
    const report = await w.operator.reconcileUnknown({ olderThanMs: AGE, limit: 10 });
    expect(report.payments.left).toBe(1);
    expect(w.scripted.calls.filter(call => call.op === "createIntent")).toHaveLength(1);
  });

  test("a crash after replay response cannot close the attempt before evidence commits", async () => {
    let failWriter = false;
    const w = await recoveryWorld(ledgerKind, { wrapLedger: (ledger): PaymentsLedger => ({
      transaction: ({ fn }) => ledger.transaction({ fn: tx => fn(new Proxy(tx, {
        get(target, name) {
          if (failWriter && name === "updatePayment") return async () => { throw new Error("crash before evidence commit"); };
          return Reflect.get(target, name).bind(target);
        },
      }) as LedgerTx) }),
    }) });
    Object.assign(w.scripted.provider, { intentReplayWindowMs: 23 * 60 * 60 * 1_000 });
    w.scripted.queue("createIntent", timedOut());
    const first = await w.service.createIntent(request, { line });
    if (first.ok || !first.payment) throw new Error("expected unknown");
    w.tick(AGE * 2); failWriter = true;
    expect((await w.operator.reconcileUnknown({ olderThanMs: AGE, limit: 10 })).payments.errors).toBe(1);
    const interrupted = await w.read(first.payment.id);
    expect(interrupted.payment).toMatchObject({ status: "unknown", providerRef: null });
    expect(interrupted.attempts[0]).toMatchObject({ outcome: "unknown", recoveryAttempts: 1 });
    failWriter = false; w.tick(23 * 60 * AGE / 3);
    expect((await createPaymentsOperator(w.deps).reconcileUnknown({ olderThanMs: AGE, limit: 10 })).payments.settled).toBe(1);
    expect((await w.read(first.payment.id)).payment).toMatchObject({ status: "succeeded" });
    const calls = w.scripted.calls.filter(call => call.op === "createIntent");
    expect(calls).toHaveLength(3); expect(calls[2]!.req).toEqual(calls[0]!.req);
  });

  test("provider-specific extras are never persisted or automatically replayed", async () => {
    const w = await recoveryWorld(ledgerKind);
    Object.assign(w.scripted.provider, { intentReplayWindowMs: 60 * AGE });
    w.scripted.queue("createIntent", timedOut());
    const first = await w.service.createIntent(request, { line, providerOptions: { secret: "test-private-extra" } });
    if (first.ok || !first.payment) throw new Error("expected unknown");
    const attempt = (await w.read(first.payment.id)).attempts[0]!;
    expect(attempt.dispatchJson).toBeNull();
    w.tick(AGE * 2);
    expect((await w.operator.reconcileUnknown({ olderThanMs: AGE, limit: 10 })).payments.left).toBe(1);
    expect(w.scripted.calls.filter(call => call.op === "createIntent")).toHaveLength(1);
  });

  test("legacy unknown rows without a dispatch snapshot remain unresolved", async () => {
    const { w, payment } = await unknown(ledgerKind);
    const attempt = (await w.read(payment.id)).attempts[0]!;
    await w.ledger.transaction({ fn: tx => tx.updateAttempt({ id: attempt.id, patch: { dispatchJson: null, updatedAt: attempt.updatedAt } }) });
    expect((await w.operator.reconcileUnknown({ olderThanMs: AGE, limit: 10 })).payments.left).toBe(1);
    expect(w.scripted.calls.filter(call => call.op === "createIntent")).toHaveLength(1);
  });
});

test("a closed and reopened SQLite database retains enough state for same-key recovery", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jini-intent-recovery-"));
  const open = () => openSqliteFileKernel<unknown>({ filePath: join(directory, "ledger.sqlite"), open: (file, options) => new Database(file, options) });
  let kernel = open();
  try {
    await migrateCommercePayments({ kernel });
    const ledger = sqlPaymentsLedger({ kernel });
    const initial = await world({ wrapLedger: () => ledger });
    Object.assign(initial.scripted.provider, { intentReplayWindowMs: 23 * 60 * AGE });
    initial.scripted.queue("createIntent", timedOut());
    const first = await initial.service.createIntent(request, { line });
    if (first.ok || !first.payment) throw new Error("expected unknown");
    const original = initial.scripted.calls[0]!.req;
    await kernel.close(); kernel = open();
    expect((await migrateCommercePayments({ kernel })).applied).toEqual([]);
    const restarted = await world({ wrapLedger: () => sqlPaymentsLedger({ kernel }) });
    Object.assign(restarted.scripted.provider, { intentReplayWindowMs: 23 * 60 * AGE });
    restarted.tick(AGE * 2);
    expect((await restarted.operator.reconcileUnknown({ olderThanMs: AGE, limit: 10 })).payments.settled).toBe(1);
    expect(restarted.scripted.calls[0]!.req).toEqual(original);
    expect((await restarted.read(first.payment.id)).payment).toMatchObject({ status: "succeeded" });
  } finally { await kernel.close(); await rm(directory, { recursive: true, force: true }); }
});
