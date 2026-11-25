import { describe, it, expect } from "vitest";

import { applyPublishContentReport, type ApplyReportHost } from "../apply-report.js";
import type { PluginHookFailure } from "../apply-failure.js";
import { InMemoryPublishContentBaselineRepo } from "../baseline-repo.js";
import { PublishContentBundleNotFoundError } from "../gated-hooks.js";
import { InMemoryPublishContentRunRepo } from "../run-repo.js";
import { InMemoryPublishContentBundleRepo, stageBundle, type PackedEntity } from "../../transfer/index.js";
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

async function setup(options: { failOn?: { id: string; error: Error }; backstop?: boolean } = {}) {
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
  } as unknown as PublishContentHandler;
  const host: ApplyReportHost<Ports> = {
    catalog: {
      build: (deps) => {
        builtWith.push(deps);
        return { handlers: [handler], handlerByType: new Map([["note", handler]]), applyOrder: ["note"] };
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
  const { bundleId } = await stageBundle({
    input: { workspaceId: "ws", sourcePrincipalId: "src", artifactFormatVersion: 1, hashVersion: 1, entities: [entity("n1"), entity("n2")], blobManifest: [] },
    deps: { repo: bundleRepo, clock, idGen },
  });
  const input = {
    workspaceId: "ws", bundleRepo, runRepo, baselineRepo: new InMemoryPublishContentBaselineRepo(), clock, idGen,
    publishContentDeps: { workspaceId: "ws", clock, idGen, ports: {} },
  };
  const run = (overrides: { report?: PublishContentReport; bundleId?: string } = {}) =>
    applyPublishContentReport({
      input, host, report: overrides.report ?? reportOf(["n1", "n2"]), principalId: "op", bundleId: overrides.bundleId ?? bundleId, restorePointId: "rp",
    });
  return { run, applied, builtWith, runRepo };
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
