import assert from "node:assert/strict";
import { sql } from "kysely";
import { afterAll, describe, test } from "vitest";
import { mintToken, type ConfirmationTokenRecord } from "@jini-ai/core/gated-mutations";
import type { KyselyKernel } from "../../kernel/port.js";
import { SqlTokenStore } from "../repo.sql.js";
import { openTokenKernel, TABLES } from "./support/token-table.fixture.js";

/**
 * @file The confirmation-token SQL store on every embedded dialect: one query body serves SQLite and PGlite.
 * Single-use redemption, status-only expiry and the upsert `save` hold on both.
 */

const NOW = "2026-11-18T00:00:00.000Z";
const LATER = "2026-11-18T00:01:00.000Z";
const mint = (planId: string): ConfirmationTokenRecord =>
  mintToken({ planId, planHash: `hash-${planId}`, scopeId: `scope-${planId}`, confirmerPrincipalId: `user-${planId}`, now: NOW, ttlSeconds: 600, generateToken: () => `ctok_${planId}` });

const opened: KyselyKernel<unknown>[] = [];
afterAll(async () => { for (const kernel of opened) await kernel.close(); });

describe.each(["sqlite", "postgres"] as const)("token sql store [%s]", (dialect) => {
  async function make(): Promise<SqlTokenStore> {
    const kernel = await openTokenKernel({ dialect });
    opened.push(kernel);
    return new SqlTokenStore({ kernel, tables: TABLES }, {});
  }

  test("save then findByToken round-trips every binding field; an unknown token is null", async () => {
    const store = await make();
    const record = mint("p1");
    await store.save({ record });
    assert.deepEqual(await store.findByToken({ token: record.confirmationToken }), record);
    assert.equal(await store.findByToken({ token: "ctok_none" }), null);
  });

  test("tryRedeem redeems once; the second call and ten concurrent calls report exactly one winner", async () => {
    const store = await make();
    const record = mint("p1");
    await store.save({ record });
    const results = await Promise.all(Array.from({ length: 10 }, () => store.tryRedeem({ token: record.confirmationToken, now: LATER })));
    assert.equal(results.filter((r) => r.redeemed).length, 1);
    assert.deepEqual(await store.tryRedeem({ token: record.confirmationToken, now: LATER }), { redeemed: false, record: { ...record, status: "redeemed" } });
  });

  test("tryRedeem refuses an unknown token (record null) and a past-TTL token without mutating it", async () => {
    const store = await make();
    const record = mint("p1");
    await store.save({ record });
    assert.deepEqual(await store.tryRedeem({ token: "ctok_none", now: LATER }), { redeemed: false, record: null });
    assert.deepEqual(await store.tryRedeem({ token: record.confirmationToken, now: "2027-01-01T00:00:00.000Z" }), { redeemed: false, record });
    assert.equal((await store.findByToken({ token: record.confirmationToken }))?.status, "minted");
  });

  test("save upserts an existing token by its primary key and never duplicates a row", async () => {
    const store = await make();
    const record = mint("p1");
    await store.save({ record });
    await store.save({ record: { ...record, status: "expired" } });
    assert.equal((await store.findByToken({ token: record.confirmationToken }))?.status, "expired");
    assert.equal(await store.count(), 1);
  });

  test("expire revokes only a minted token: redeemed stays terminal and an unknown token inserts nothing", async () => {
    const store = await make();
    const minted = mint("p1");
    const redeemed = mint("p2");
    await store.save({ record: minted });
    await store.save({ record: redeemed });
    assert.equal((await store.tryRedeem({ token: redeemed.confirmationToken, now: LATER })).redeemed, true);
    for (const token of [minted.confirmationToken, redeemed.confirmationToken, "ctok_none"]) await store.expire({ token });
    assert.equal((await store.findByToken({ token: minted.confirmationToken }))?.status, "expired");
    assert.equal((await store.findByToken({ token: redeemed.confirmationToken }))?.status, "redeemed");
    assert.equal(await store.count(), 2);
  });

  test("count reflects the saved rows", async () => {
    const store = await make();
    assert.equal(await store.count(), 0);
    await store.save({ record: mint("p1") });
    await store.save({ record: mint("p2") });
    assert.equal(await store.count(), 2);
  });
});

test("redemption does not report success when the database declines the guarded update", async () => {
  const kernel = await openTokenKernel({ dialect: "sqlite" });
  opened.push(kernel);
  const store = new SqlTokenStore({ kernel, tables: TABLES });
  const record = mint("gated");
  await store.save({ record });
  await kernel.execute(sql`CREATE TRIGGER decline_redemption BEFORE UPDATE OF status ON gated_mutation_tokens
    WHEN NEW.status = 'redeemed' BEGIN SELECT RAISE(IGNORE); END`);
  assert.deepEqual(await store.tryRedeem({ token: record.confirmationToken, now: LATER }), { redeemed: false, record });
  assert.deepEqual(await store.findByToken({ token: record.confirmationToken }), record);
  await kernel.execute(sql`DROP TRIGGER decline_redemption`);
  const redeemed = { ...record, status: "redeemed" };
  assert.deepEqual(await store.tryRedeem({ token: record.confirmationToken, now: LATER }), { redeemed: true, record: redeemed });
  assert.deepEqual(await store.findByToken({ token: record.confirmationToken }), redeemed);
});
