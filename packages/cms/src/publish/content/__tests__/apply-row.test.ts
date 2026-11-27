import { InMemoryPublishContentBaselineRepo } from "../baseline-repo.js";
import { CONTENT_HASH_VERSION } from "../content-hash.js";
import { publishContentItemIdempotencyKey } from "../idempotency.js";
import type { PublishContentHandler } from "../type-registry.js";
import { PublishContentApplyRowError, type PackedEntity } from "../../transfer/index.js";
import { describe, expect, it, vi } from "vitest";
import { checkExistence, checkAgreement, applyOrdinaryRow, refreshNonWritingRow, applyRetiringRow, type ApplyRowContext, type ApplyRowStep, type InspectedRow } from "../apply-row.js";
import type { PublishContentOutcomeRow } from "../plan-rows.js";

const step = (outcome: string, current: InspectedRow | null) =>
  ({ row: { entityType: "post", entityId: "p1", outcome, writes: true } as unknown as PublishContentOutcomeRow, current }) as unknown as ApplyRowStep;
const existing = { version: 1, hash: "h" } as unknown as InspectedRow;

describe("checkExistence", () => {
  it("downgrades a created row whose destination row now exists", () => {
    expect(checkExistence({ step: step("created", existing) })?.row).toMatchObject({
      outcome: "conflict", writes: false, reason: "post 'p1' was created on the destination between plan and apply",
    });
  });
  it("downgrades an applied row whose destination row is now gone", () => {
    expect(checkExistence({ step: step("applied", null) })?.row.reason).toBe("post 'p1' was removed from the destination between plan and apply");
  });
  it("lets agreeing rows through", () => {
    expect(checkExistence({ step: step("created", null) })).toBeNull();
    expect(checkExistence({ step: step("applied", existing) })).toBeNull();
  });
});

function rowFixture() {
  const entity: PackedEntity = { entityType: "media", id: "photo-7", schemaVersion: 1, hashVersion: CONTENT_HASH_VERSION,
    contentHash: "source-hash", requiredBlobs: [], state: { title: "Coast", createdByPrincipalId: "source-author" } };
  const row: PublishContentOutcomeRow = { entityType: "media", entityId: "photo-7", entityLabel: "Coast", outcome: "applied",
    writes: true, reason: null, canOverwrite: false, retires: null };
  const baselineRepo = new InMemoryPublishContentBaselineRepo();
  const baselineKey = { workspaceId: "live", peerPrincipalId: "peer-preview", entityType: "media", entityId: "photo-7" };
  const key = "media:photo-7";
  const current = { hash: "live-hash", version: 8 };
  const apply = vi.fn<PublishContentHandler["apply"]>(async () => ({ changeSetId: "change-7" }));
  const seedHash = vi.fn<NonNullable<PublishContentHandler["seedHash"]>>(async () => null);
  const inspect = vi.fn<PublishContentHandler["inspect"]>(async () => current);
  const handler: PublishContentHandler = { entityType: "media", schemaVersion: 1, permission: "content.write", dependsOn: [],
    pack: async function* () {}, inspect, precheck: async () => null, apply, seedHash };
  const getSeedHash = vi.fn<ApplyRowContext["getSeedHash"]>(async () => null);
  const recordContentApplied = vi.fn<ApplyRowContext["recordContentApplied"]>();
  const ctx: ApplyRowContext = { workspaceId: "live", sourcePrincipalId: "peer-preview", principalId: "operator-2", runId: "run-5",
    entityByKey: new Map([[key, entity]]), handlerByType: new Map([["media", handler]]),
    baselineRepo, clock: { nowMs: () => Date.parse("2026-01-02T00:00:00Z") }, getSeedHash, recordContentApplied };
  async function setBaseline(hashAtLastSync: string, hashVersion: number) {
    await baselineRepo.upsert({ record: { ...baselineKey, hashAtLastSync, hashVersion, runId: "previous", syncedAt: "2026-01-01T00:00:00Z" } });
  }
  return { entity, row, baselineRepo, baselineKey, setBaseline, key, current, apply, inspect, seedHash, getSeedHash,
    recordContentApplied, ctx, handler, step: { row, ctx, key, entity, handler, current } };
}

it("refuses a live edit even when the seed agrees if this peer already has a newer-generation baseline", async () => {
  const f = rowFixture();
  await f.setBaseline("other-live-hash", CONTENT_HASH_VERSION);
  f.getSeedHash.mockResolvedValueOnce("live-hash");
  expect(await checkAgreement({ step: f.step, current: f.current })).toEqual({
    row: { ...f.row, writes: false, outcome: "conflict", reason: "media 'photo-7' was edited on the destination again after this run's own plan was built" },
    changeSetId: null, retiredChangeSetId: null,
  });
  expect(f.getSeedHash).not.toHaveBeenCalled();
  expect(f.seedHash).not.toHaveBeenCalled();
});

it.each(["workspace seed", "handler seed", "no seed"] as const)("falls back from an obsolete baseline to the %s", async source => {
  const f = rowFixture();
  await f.setBaseline("obsolete-hash", CONTENT_HASH_VERSION - 1);
  if (source === "workspace seed") f.getSeedHash.mockResolvedValueOnce("live-hash");
  if (source === "handler seed") f.seedHash.mockResolvedValueOnce("live-hash");
  const result = await checkAgreement({ step: f.step, current: f.current });
  expect(f.getSeedHash).toHaveBeenCalledExactlyOnceWith({ entityType: "media", entityId: "photo-7" });
  expect(f.seedHash.mock.calls).toEqual(source === "workspace seed" ? [] : [[{ id: "photo-7" }]]);
  expect(result).toEqual(source === "no seed" ? {
    row: { ...f.row, writes: false, outcome: "conflict", reason: "media 'photo-7' was edited on the destination again after this run's own plan was built" },
    changeSetId: null, retiredChangeSetId: null,
  } : null);
});

it("applies only the verified source replacement for the acting operator and syncs to the post-write hash", async () => {
  const f = rowFixture();
  const sourceReplacement = { version: 8, sourceSha256: "live-bytes" };
  const row = { ...f.row, outcome: "forced" as const, canOverwrite: true, sourceReplacement };
  const handler: PublishContentHandler = { ...f.handler, idempotencyScope: "run" };
  f.inspect.mockResolvedValueOnce({ hash: "normalized-live-hash", version: 9 });
  expect(await applyOrdinaryRow({ step: { ...f.step, row, handler } })).toEqual({ row, changeSetId: "change-7", retiredChangeSetId: null });
  expect(f.apply).toHaveBeenCalledExactlyOnceWith({ entity: f.entity, expectedVersion: 8, principalId: "operator-2", sourceReplacement,
    idempotencyKey: publishContentItemIdempotencyKey({ workspaceId: "live", sourcePrincipalId: "peer-preview", entity: f.entity, sourceReplacement }) + ":run-5",
  });
  expect(f.recordContentApplied).toHaveBeenCalledExactlyOnceWith({ itemKey: "media:photo-7", changeSetId: "change-7" });
  expect(f.inspect).toHaveBeenCalledExactlyOnceWith({ id: "photo-7" });
  expect(await f.baselineRepo.findOne(f.baselineKey)).toEqual({ ...f.baselineKey, hashAtLastSync: "normalized-live-hash",
    hashVersion: CONTENT_HASH_VERSION, syncedAt: "2026-01-02T00:00:00.000Z", runId: "run-5" });
});

it("leaves the baseline and change ledger unchanged when apply refuses the row", async () => {
  const f = rowFixture();
  f.apply.mockRejectedValueOnce(new PublishContentApplyRowError({ rowOutcome: "blocked", message: "The source blob is missing." }));
  expect(await applyOrdinaryRow({ step: f.step })).toEqual({
    row: { ...f.row, outcome: "blocked", writes: false, reason: "The source blob is missing." }, changeSetId: null, retiredChangeSetId: null,
  });
  expect(f.recordContentApplied).not.toHaveBeenCalled();
  expect(await f.baselineRepo.findOne(f.baselineKey)).toBeNull();
});

it.each(["unchanged", "blocked", "conflict"] as const)("refreshes only the unchanged baseline, not a %s write", async outcome => {
  const f = rowFixture();
  const row = { ...f.row, outcome, writes: false };
  expect(await refreshNonWritingRow({ row, ctx: f.ctx })).toEqual({ row, changeSetId: null, retiredChangeSetId: null });
  expect(await f.baselineRepo.findOne(f.baselineKey)).toEqual(outcome === "unchanged" ? {
    ...f.baselineKey, hashAtLastSync: "source-hash", hashVersion: CONTENT_HASH_VERSION, syncedAt: "2026-01-02T00:00:00.000Z", runId: "run-5",
  } : null);
  expect(f.apply).not.toHaveBeenCalled();
});

it("retire/create handoff retains both change-set IDs while stamping the new baseline", async () => {
  const f = rowFixture();
  const retires = { entityType: "media", entityId: "old-asset", entityLabel: "Old asset", hash: "old-live" };
  const row = { ...f.row, outcome: "forced" as const, retires };
  const planRetire = vi.fn(async () => retires);
  const retire = vi.fn(async () => ({ changeSetId: "retired-8", undo: async () => {} }));
  const handler = { ...f.handler, planRetire, retire };
  const itemKey = publishContentItemIdempotencyKey({ workspaceId: "live", sourcePrincipalId: "peer-preview", entity: f.entity });
  expect(await applyRetiringRow({ step: { ...f.step, row, handler, current: null } })).toEqual({
    row, changeSetId: "change-7", retiredChangeSetId: "retired-8",
  });
  expect(retire).toHaveBeenCalledExactlyOnceWith({ target: retires, principalId: "operator-2", idempotencyKey: itemKey + ":retire:run-5" });
  expect(f.apply).toHaveBeenCalledExactlyOnceWith({ entity: f.entity, expectedVersion: undefined, principalId: "operator-2", idempotencyKey: itemKey });
  expect(f.recordContentApplied).toHaveBeenCalledExactlyOnceWith({ itemKey: "media:photo-7", changeSetId: "change-7", retiredChangeSetId: "retired-8" });
  expect((await f.baselineRepo.findOne(f.baselineKey))?.hashAtLastSync).toBe("source-hash");
});

it("names both failures if the new entity cannot be created and the retired entity cannot be restored", async () => {
  const f = rowFixture();
  const retires = { entityType: "media", entityId: "old-asset", entityLabel: "Old asset", hash: "old-live" };
  const row = { ...f.row, outcome: "forced" as const, retires };
  const undo = vi.fn(async () => { throw new Error("restore failed"); });
  const handler = { ...f.handler, planRetire: async () => retires, retire: async () => ({ changeSetId: "retired-8", undo }) };
  f.apply.mockRejectedValueOnce(new Error("create failed"));
  await expect(applyRetiringRow({ step: { ...f.step, row, handler, current: null } })).rejects.toThrow(
    "media 'photo-7' was not created (create failed), and putting the retired media 'old-asset' back failed too (restore failed) — restore it from Trash",
  );
  expect(undo).toHaveBeenCalledExactlyOnceWith();
  expect(f.recordContentApplied).not.toHaveBeenCalled();
  expect(await f.baselineRepo.findOne(f.baselineKey)).toBeNull();
});
