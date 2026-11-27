import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";

import { applyPublishContentReport, type ApplyReportHost } from "../apply-report.js";
import type { PluginHookFailure } from "../apply-failure.js";
import { InMemoryPublishContentBaselineRepo } from "../baseline-repo.js";
import { PublishContentBundleNotFoundError } from "../gated-hooks.js";
import { getPublishContentRunStatus, InMemoryPublishContentRunRepo, type PublishContentRunRecord } from "../run-repo.js";
import { InMemoryPublishContentBundleRepo, stageBundle, type PackedEntity, type BackstopAuditRecord, type BackstopInverse, type BackstopPorts, type RawRowPort } from "../../transfer/index.js";
import type { PublishContentOutcomeRow, PublishContentReport } from "../plan-rows.js";
import type { PublishContentHandler } from "../type-registry.js";

type Ports = { readonly note: { readonly tag: string } };

/** A neutral stand-in for the host's plugin-host refusal class. */
class HookRefusal extends Error implements PluginHookFailure {
  constructor(readonly pluginId: string, message: string, readonly refusedItemRef?: string) { super(message); }
}

function entity(id: string): PackedEntity {
  return { entityType: "note", id, schemaVersion: 1, contentHash: `hash-${id}`, hashVersion: 1, requiredBlobs: [], state: { body: id } };
}

function row(id: string): PublishContentOutcomeRow {
  return { entityType: "note", entityId: id, entityLabel: null, outcome: "created", writes: true, reason: null, canOverwrite: false, retires: null };
}

function reportOf(ids: string[], refused = false): PublishContentReport {
  return { refused, refusalReason: refused ? "refused at plan" : null, applyOrder: ["note"], rows: ids.map(row) };
}

async function setup(options: { failOn?: { id: string; error: Error }; backstop?: boolean; ports?: BackstopPorts; handler?: Partial<PublishContentHandler>; entities?: PackedEntity[] } = {}) {
  const store = new Map<string, { version: number; hash: string }>();
  const applied: string[] = [];
  const builtWith: unknown[] = [];
  const handler = {
    entityType: "note", schemaVersion: 1, permission: "note.publish", dependsOn: [],
    inspect: async ({ id }: { id: string }) => store.get(id) ?? null,
    apply: async ({ entity: e }: { entity: PackedEntity }) => {
      if (options.failOn?.id === e.id) throw options.failOn.error;
      applied.push(e.id);
      store.set(e.id, { version: 1, hash: e.contentHash });
      return { changeSetId: `cs-${e.id}` };
    },
    ...options.handler,
  } as unknown as PublishContentHandler;
  const host: ApplyReportHost<Ports> = {
    catalog: {
      build: (deps) => {
        builtWith.push(deps);
        return { handlers: [handler], handlerByType: new Map([[handler.entityType, handler]]), applyOrder: [handler.entityType] };
      },
    },
    readBackstopMetadata: () => (options.backstop ? ({ sourceActor: "a", destinationHost: "d", reason: "r", gapLabels: [] } as never) : null),
    pluginHooks: {
      isPluginHookFailure: (e): e is PluginHookFailure => e instanceof HookRefusal,
      attachRefusedItem: (failure, ref) => new HookRefusal(failure.pluginId, failure.message, ref),
    },
  };
  let tick = 0;
  const clock = { nowMs: () => Date.UTC(2026, 0, 1) + tick++ * 1000 };
  const idGen = { newId: () => `id-${tick++}` };
  const bundleRepo = new InMemoryPublishContentBundleRepo();
  const runRepo = new InMemoryPublishContentRunRepo();
  const snapshots: PublishContentRunRecord[] = [];
  const baselineRepo = new InMemoryPublishContentBaselineRepo();
  const { bundleId } = await stageBundle({
    input: { workspaceId: "ws", sourcePrincipalId: "src", artifactFormatVersion: 1, hashVersion: 1, entities: options.entities ?? [entity("n1"), entity("n2")], blobManifest: [] },
    deps: { repo: bundleRepo, clock, idGen },
  });
  const input = {
    workspaceId: "ws", bundleRepo, runRepo: {
      findById: (input: { workspaceId: string; id: string }) => runRepo.findById(input),
      save: async ({ record }: { record: PublishContentRunRecord }) => { snapshots.push(record); await runRepo.save({ record }); },
    }, baselineRepo, clock, idGen,
    publishContentDeps: { workspaceId: "ws", clock, idGen, ports: {}, ...(options.ports ? { backstop: options.ports } : {}) },
  };
  const run = (overrides: { report?: PublishContentReport; bundleId?: string } = {}) =>
    applyPublishContentReport({
      input, host, report: overrides.report ?? reportOf(["n1", "n2"]), principalId: "op", actor: { id: "op", kind: "user" }, bundleId: overrides.bundleId ?? bundleId, restorePointId: "rp",
    });
  return { run, applied, builtWith, runRepo, store, baselineRepo, snapshots };
}

describe("applyPublishContentReport", () => {
  it("applies each row through the injected catalog and records the run as applied", async () => {
    const s = await setup();
    const result = await s.run();
    expect(s.applied).toEqual(["n1", "n2"]);
    expect(result.changeSetIds).toEqual(["cs-n1", "cs-n2"]);
    expect(result.retiredChangeSetIds).toEqual([]);
    expect(s.builtWith).toHaveLength(1);
    expect((await s.runRepo.findById({ workspaceId: "ws", id: result.runId }))?.phase).toBe("applied");
  });

  it("abandons a report that was refused at plan time without reading the catalog or writing", async () => {
    const s = await setup();
    const result = await s.run({ report: reportOf(["n1"], true) });
    expect(result.changeSetIds).toEqual([]);
    expect(s.builtWith).toHaveLength(0);
    expect(s.applied).toEqual([]);
    expect((await s.runRepo.findById({ workspaceId: "ws", id: result.runId }))?.phase).toBe("abandoned");
  });

  it("says so when the staged bundle is gone", async () => {
    const s = await setup();
    await expect(s.run({ bundleId: "missing" })).rejects.toBeInstanceOf(PublishContentBundleNotFoundError);
  });

  it("names the refused item on a plugin hook refusal, using the injected predicate and rebuilder", async () => {
    const s = await setup({ failOn: { id: "n2", error: new HookRefusal("plug-1", "hook said no") } });
    const thrown = await s.run().catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(HookRefusal);
    expect((thrown as HookRefusal).refusedItemRef).toBe("note:n2");
    expect((thrown as HookRefusal).pluginId).toBe("plug-1");
    expect(s.applied).toEqual(["n1"]);
  });

  it("rethrows any other failure unchanged", async () => {
    const boom = new Error("disk full");
    const s = await setup({ failOn: { id: "n1", error: boom } });
    await expect(s.run()).rejects.toBe(boom);
  });

  it("refuses a hand-send whose audit storage is not installed, using the injected metadata reader", async () => {
    const s = await setup({ backstop: true });
    await expect(s.run()).rejects.toThrow("Send by hand needs its audit storage installed");
    expect(s.applied).toEqual([]);
  });
});

it("persists the effective report and verifies only items that survived apply-time rechecks", async () => {
  const verifyApplied = vi.fn<NonNullable<PublishContentHandler["verifyApplied"]>>(async () => ["A linked asset needs repair."]);
  const s = await setup({ handler: { verifyApplied }, entities: [entity("n1"), entity("n2"), entity("same")] });
  s.store.set("n2", { version: 7, hash: "edited-after-plan" });
  s.store.set("same", { version: 1, hash: "hash-same" });
  await s.baselineRepo.upsert({ record: { workspaceId: "ws", peerPrincipalId: "src", entityType: "note", entityId: "n2",
    hashAtLastSync: "at-plan", hashVersion: 1, syncedAt: "2025-01-01T00:00:00Z", runId: "old" } });
  const report = { ...reportOf([]), rows: [row("n1"), { ...row("n2"), outcome: "applied" as const },
    { ...row("same"), outcome: "unchanged" as const, writes: false }, row("missing")] };
  const result = await s.run({ report });
  expect(result.report?.rows.map(({ entityId, outcome, writes, reason }) => [entityId, outcome, writes, reason])).toEqual([
    ["n1", "created", true, null],
    ["n2", "conflict", false, "note 'n2' was edited on the destination again after this run's own plan was built"],
    ["same", "unchanged", false, null],
    ["missing", "blocked", false, "internal inconsistency: no packed entity/handler for note 'missing' at apply time"],
  ]);
  expect(result.verificationProblems).toEqual(["A linked asset needs repair."]);
  expect(verifyApplied).toHaveBeenCalledExactlyOnceWith({ entities: [entity("n1"), entity("same")] });
  expect(s.store.get("n2")).toEqual({ version: 7, hash: "edited-after-plan" });
  expect(s.applied).toEqual(["n1"]);
  const status = await getPublishContentRunStatus({ repo: s.runRepo, input: { workspaceId: "ws", runId: result.runId } });
  expect(status?.report).toEqual(result.report);
  expect(status?.items.find(item => item.entityId === "missing")?.idempotencyKey).toMatch(/^publish-content:v1:missing:[0-9a-f]{64}$/);
  expect(status?.changeSetIds).toEqual(["cs-n1"]);
});

it("persists each row's progress but lists a shared change set only once", async () => {
  const destination = new Map<string, { version: number; hash: string }>();
  const s = await setup({ handler: {
    inspect: async ({ id }) => destination.get(id) ?? null,
    apply: async ({ entity: packed }) => {
      destination.set(packed.id, { version: 1, hash: packed.contentHash });
      return { changeSetId: "shared-change" };
    },
  } });
  const result = await s.run();
  const status = await getPublishContentRunStatus({ repo: s.runRepo, input: { workspaceId: "ws", runId: result.runId } });
  expect(status?.changeSetIds).toEqual(["shared-change"]);
  expect(status?.retiredChangeSetIds).toEqual([]);
  expect(status?.items.map(({ entityId, phase, changeSetId }) => ({ entityId, phase, changeSetId }))).toEqual([
    { entityId: "n1", phase: "completed", changeSetId: "shared-change" },
    { entityId: "n2", phase: "completed", changeSetId: "shared-change" },
  ]);
  expect([...destination]).toEqual([["n1", { version: 1, hash: "hash-n1" }], ["n2", { version: 1, hash: "hash-n2" }]]);
});

it.each(["success", "failure"] as const)("repoints references after a landed retire/create even if a later row has a %s", async outcome => {
  const retires = { entityType: "note", entityId: "old", entityLabel: "Old note", hash: "hash-old" };
  const repointReferences = vi.fn<NonNullable<PublishContentHandler["repointReferences"]>>(async () => ({
    changeSetIds: ["repoint-1"], linksUpdated: 2, notUpdated: ["Footer was edited again."],
  }));
  const verifyApplied = vi.fn<NonNullable<PublishContentHandler["verifyApplied"]>>(async () => { throw new Error("asset catalog offline"); });
  const laterFailure = new Error("later row could not write");
  const s = await setup({ ...(outcome === "failure" ? { failOn: { id: "n2", error: laterFailure } } : {}),
    handler: { planRetire: async () => retires, retire: async () => ({ changeSetId: "retired-1", undo: async () => {} }),
      repointReferences, verifyApplied },
  });
  const report = { ...reportOf([]), rows: [{ ...row("n1"), outcome: "forced" as const, retires }, row("n2")] };
  if (outcome === "failure") await expect(s.run({ report })).rejects.toBe(laterFailure);
  else {
    const result = await s.run({ report });
    expect(result).toMatchObject({ retiredChangeSetIds: ["retired-1"], repointChangeSetIds: ["repoint-1"], menuLinksUpdated: 2,
      menuLinksNotUpdated: ["Footer was edited again."], verificationProblems: ["Note could not be checked after publishing: asset catalog offline"] });
    expect(verifyApplied).toHaveBeenCalledExactlyOnceWith({ entities: [entity("n1"), entity("n2")] });
  }
  const snapshot = s.snapshots.at(-1)!;
  expect(snapshot.phase).toBe(outcome === "failure" ? "failed" : "applied");
  expect(repointReferences).toHaveBeenCalledExactlyOnceWith({
    replacements: [{ entityType: "note", oldId: "old", newId: "n1" }],
    skipIds: new Set(outcome === "failure" ? ["n1"] : ["n1", "n2"]), principalId: "op", runId: snapshot.id,
  });
  expect(s.store.get("n1")).toEqual({ version: 1, hash: "hash-n1" });
});

it("reports a reference repair failure without undoing the landed replacement", async () => {
  const retires = { entityType: "note", entityId: "old", entityLabel: "Old note", hash: "hash-old" };
  const undo = vi.fn(async () => {});
  const repointReferences = vi.fn<NonNullable<PublishContentHandler["repointReferences"]>>(async () => { throw "reference adapter offline"; });
  const s = await setup({ handler: { planRetire: async () => retires,
    retire: async () => ({ changeSetId: "retire-old", undo }), repointReferences } });
  const result = await s.run({ report: { ...reportOf([]), rows: [{ ...row("n1"), outcome: "forced", retires }] } });
  expect(result).toMatchObject({ changeSetIds: ["cs-n1"], retiredChangeSetIds: ["retire-old"],
    repointChangeSetIds: [], menuLinksUpdated: 0, menuLinksNotUpdated: ["Note links were not updated: reference adapter offline"] });
  expect(repointReferences).toHaveBeenCalledExactlyOnceWith({ replacements: [{ entityType: "note", oldId: "old", newId: "n1" }],
    skipIds: new Set(["n1"]), principalId: "op", runId: result.runId });
  expect(undo).not.toHaveBeenCalled();
  expect(s.store.get("n1")).toEqual({ version: 1, hash: "hash-n1" });
  expect((await s.runRepo.findById({ workspaceId: "ws", id: result.runId }))?.phase).toBe("applied");
});

it("audits a hand-send from pending through completed verification without exposing live content values", async () => {
  const audits: BackstopAuditRecord[] = [];
  const s = await setup({ backstop: true, ports: { coveredTables: [], coveredRoots: [],
    audit: { ready: async () => true, save: async ({ record }) => { audits.push(record); },
      get: async ({ id }) => audits.findLast(record => record.id === id) ?? null, gaps: async () => [] },
  } });
  s.store.set("n2", { version: 7, hash: "old-hash" });
  const result = await s.run({ report: { ...reportOf([]), rows: [row("n1"), { ...row("n2"), outcome: "forced", writes: true }] } });
  expect(audits.map(({ id, result: phase, actorId, destination, items }) => ({ id, phase, actorId, destination, items }))).toEqual(
    ["pending", "success"].map(phase => ({
      id: result.runId, phase, actorId: "a", destination: "d", items: [
        { entityType: "note", id: "n1", beforeHash: null, afterHash: "hash-n1" },
        { entityType: "note", id: "n2", beforeHash: "old-hash", afterHash: "hash-n2" },
      ],
    })),
  );
  expect(audits.at(-1)?.details).toEqual({ report: result.report });
  expect(s.store.get("n2")).toEqual({ version: 1, hash: "hash-n2" });
});

it("records the actual pre-write file version from the inverse and keeps new files without a before hash", async () => {
  const existing = { ...entity("footer.html"), entityType: "raw-file" };
  const added = { ...entity("header.html"), entityType: "raw-file" };
  const live = new Map([[existing.id, { version: 7, hash: "seen-before-transaction" }]]);
  const audits: BackstopAuditRecord[] = [];
  const inverses: BackstopInverse[] = [];
  const rows: RawRowPort = { read: async () => null, columns: async () => null, upsert: vi.fn(), removeCreated: vi.fn(),
    transaction: async ({ work }) => work() };
  const s = await setup({ backstop: true, entities: [existing, added], ports: { rows, inverses, coveredRoots: [], coveredTables: [],
    audit: { ready: async () => true, save: async ({ record }) => { audits.push(record); }, get: async () => null, gaps: async () => [] },
  }, handler: { entityType: "raw-file", inspect: async ({ id }) => live.get(id) ?? null, apply: async ({ entity: packed }) => {
    const captured = live.get(packed.id);
    inverses.push({ kind: "raw-file", entity: packed, afterHash: packed.contentHash, before: {
      relPath: packed.id, backupName: captured ? "footer.saved" : null, sha256: captured ? "saved-bytes" : null,
      size: captured ? 28 : null, mode: 0o644,
    } });
    live.set(packed.id, { version: (captured?.version ?? 0) + 1, hash: packed.contentHash });
    return { changeSetId: `change-${packed.id}` };
  } } });
  const auditHash = createHash("sha256").update('{"entityType":"raw-file","state":{"mode":420,"path":"footer.html","sha256":"saved-bytes","size":28}}').digest("hex");
  await s.run({ report: { ...reportOf([]), applyOrder: ["raw-file"], rows: [
    { ...row(existing.id), entityType: "raw-file", outcome: "forced" }, { ...row(added.id), entityType: "raw-file" },
  ] } });
  expect(audits.map(audit => ({ result: audit.result, before: audit.items.map(({ id, beforeHash }) => [id, beforeHash]) }))).toEqual([
    { result: "pending", before: [["footer.html", "seen-before-transaction"], ["header.html", null]] },
    { result: "success", before: [["footer.html", auditHash], ["header.html", null]] },
  ]);
  expect(audits.at(-1)?.inverses.map(inverse => [inverse.entity.id, inverse.kind])).toEqual([["footer.html", "raw-file"], ["header.html", "raw-file"]]);
  expect([...live]).toEqual([["footer.html", { version: 8, hash: "hash-footer.html" }], ["header.html", { version: 1, hash: "hash-header.html" }]]);
});

it("compensates files in reverse order when a raw transaction fails and records a failed audit", async () => {
  const originalError = new Error("foreign key check refused the send");
  const auditRecords: BackstopAuditRecord[] = [];
  const compensation: string[] = [];
  const liveFiles = new Map([["theme.css", "old"]]);
  const raw: PackedEntity = { ...entity("theme.css"), entityType: "raw-file" };
  const inverse: BackstopInverse = { kind: "raw-file", entity: raw, afterHash: raw.contentHash,
    before: { relPath: "theme.css", backupName: "fixture-backup", sha256: "old-hash", size: 3, mode: 0o644 } };
  const inverses: BackstopInverse[] = [];
  const rows: RawRowPort = { read: async () => null, columns: async () => null, upsert: vi.fn(), removeCreated: vi.fn(),
    transaction: async ({ work }) => { await work(); throw originalError; } };
  const s = await setup({ backstop: true, entities: [raw], handler: { entityType: "raw-file",
      apply: async ({ entity }) => {
        liveFiles.set(entity.id, "new");
        inverses.push(inverse);
        return { changeSetId: "raw-change" };
      } },
    ports: { rows, inverses, coveredTables: [], coveredRoots: [],
      fileRollbacks: [async () => { compensation.push("first"); }, async () => { compensation.push("second"); throw new Error("backup missing"); }],
      audit: { ready: async () => true, save: async ({ record }) => { auditRecords.push(record); }, get: async () => null, gaps: async () => [] },
    },
  });
  const rawRow: PublishContentOutcomeRow = { ...row("theme.css"), entityType: "raw-file" };
  await expect(s.run({ report: { ...reportOf([]), applyOrder: ["raw-file"], rows: [rawRow] } })).rejects.toBe(originalError);
  expect(compensation).toEqual(["second", "first"]);
  expect(liveFiles.get("theme.css")).toBe("new");
  const last = s.snapshots.at(-1)!;
  expect(last.phase).toBe("failed");
  expect(JSON.parse(last.reportJson!)).toMatchObject({ rows: [{ entityId: "theme.css", outcome: "blocked",
    writes: true, reason: "foreign key check refused the send backup missing" }] });
  expect(auditRecords.at(-1)).toMatchObject({ result: "failure", inverses: [inverse], details: {
    error: "foreign key check refused the send", rollbackErrors: ["backup missing"],
  } });
});

it("refuses a raw file send without a transaction and records the failed attempt before any file write", async () => {
  const raw: PackedEntity = { ...entity("footer.html"), entityType: "raw-file" };
  const audits: BackstopAuditRecord[] = [];
  const s = await setup({ backstop: true, entities: [raw], handler: { entityType: "raw-file" }, ports: {
    coveredRoots: [], coveredTables: [],
    audit: { ready: async () => true, save: async ({ record }) => { audits.push(record); }, get: async () => null, gaps: async () => [] },
  } });
  const message = "The raw-row transaction port is not wired.";
  const report: PublishContentReport = { ...reportOf([]), applyOrder: ["raw-file"], rows: [{ ...row(raw.id), entityType: "raw-file" }] };
  await expect(s.run({ report })).rejects.toThrow(message);
  expect(s.applied).toEqual([]);
  expect(s.store.size).toBe(0);
  expect(s.snapshots.map(({ phase }) => phase)).toEqual(["applying", "failed"]);
  expect(audits.map(({ result, details, inverses }) => ({ result, details, inverses }))).toEqual([
    { result: "pending", details: {}, inverses: [] },
    { result: "failure", details: { error: message, rollbackErrors: [] }, inverses: [] },
  ]);
});
