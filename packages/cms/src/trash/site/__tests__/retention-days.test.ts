import { expect, test } from "vitest";
import { createTrashSweep } from "../../sweeper.js";
import { AT, harness, removal, WS } from "../../__tests__/fixture.js";
import * as sitePorts from "../ports.js";

/**
 * @file Owner decision G7-4: the trash retention window is ONE host-owned value (30 days in practice),
 * injected into the engine. The engine's site ports no longer carry a retention constant.
 *
 * The window is stamped into `purge_after` when an item is trashed, so the sweeper never reads
 * it. These tests drive the real write path with a host-injected 30-day window and then ask the
 * real sweep what is due, rather than asserting a bare number alone.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAfterTrashing = (days: number): string => new Date(Date.parse(AT) + days * DAY_MS).toISOString();

function sweepClaim(now: string) {
  return { now, leaseOwner: "retention-test", leaseUntil: new Date(Date.parse(now) + 60_000).toISOString(), limit: 50 };
}

/** What a host injects (e.g. a host's own `TRASH_RETENTION_DAYS`); the engine itself owns no value. */
const HOST_RETENTION_DAYS = 30;

test("the engine site ports export no retention constant: the host owns the window", () => {
  expect("TRASH_RETENTION_DAYS" in sitePorts).toBe(false);
});

test("an item trashed with the host window is stamped purge_after = trashed-at + 30 days", async () => {
  const h = harness({ retentionDays: HOST_RETENTION_DAYS });
  await h.trash.trash(removal);
  const row = await h.repo.findByEntity({ workspaceId: WS, entityType: "record", entityId: "record-1" });
  expect(row?.purgeAfter).toBe(daysAfterTrashing(30));
});

test("the sweep leaves a 29-day-old trashed item alone and purges a 31-day-old one", async () => {
  const h = harness({ retentionDays: HOST_RETENTION_DAYS });
  await h.trash.trash(removal);
  const { idGen: _idGen, ...sweepDeps } = h.deps;
  const sweep = createTrashSweep(sweepDeps);

  expect(await sweep(sweepClaim(daysAfterTrashing(29)))).toEqual({ claimed: 0, purged: 0, results: [] });
  expect(await h.records.findById({ workspaceId: WS, id: "record-1" })).not.toBeNull();

  const report = await sweep(sweepClaim(daysAfterTrashing(31)));
  expect(report.purged).toBe(1);
  expect(await h.records.findById({ workspaceId: WS, id: "record-1" })).toBeNull();
});
