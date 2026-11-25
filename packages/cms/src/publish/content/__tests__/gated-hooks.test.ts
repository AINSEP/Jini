import { describe, it, expect } from "vitest";

import { buildPublishContentImportHooks, PublishContentBundleNotFoundError, type BuildPublishContentImportHooksInput } from "../gated-hooks.js";
import { createPublishContentTypeRegistry, type PublishContentHandler } from "../type-registry.js";
import { InMemoryPublishContentBaselineRepo } from "../baseline-repo.js";
import { CONTENT_HASH_VERSION, contentHash } from "../content-hash.js";
import type { PublishContentReport } from "../plan-rows.js";
import { InMemoryPublishContentBundleRepo, type StagedBundleRecord } from "../../transfer/bundle-staging.js";
import { PUBLISH_CONTENT_ARTIFACT_FORMAT_VERSION } from "../../transfer/artifact-format.js";

type Ports = Record<string, never>;

const WORKSPACE_ID = "ws-1";
const BUNDLE_ID = "bundle-1";
const ACTOR_ID = "operator-1";
const ENTITY_TYPE = "thing";
const ENTITY_ID = "thing-1";
const INCOMING_HASH = contentHash({ entityType: ENTITY_TYPE, state: { title: "incoming" } });

function stagedBundle(): StagedBundleRecord {
  return {
    id: BUNDLE_ID, workspaceId: WORKSPACE_ID, sourcePrincipalId: "peer-1",
    artifactFormatVersion: PUBLISH_CONTENT_ARTIFACT_FORMAT_VERSION, hashVersion: CONTENT_HASH_VERSION,
    entitiesJson: JSON.stringify([{ entityType: ENTITY_TYPE, id: ENTITY_ID, schemaVersion: 1, contentHash: INCOMING_HASH, hashVersion: CONTENT_HASH_VERSION, requiredBlobs: [], state: { title: "incoming" } }]),
    blobManifestJson: "[]", sizeBytes: 128, receivedAt: "2026-09-20T00:00:00.000Z", expiresAt: "2026-09-21T00:00:00.000Z",
  };
}

const handler: PublishContentHandler = {
  entityType: ENTITY_TYPE, schemaVersion: 1, permission: "content.write", dependsOn: [],
  pack: async function* () {}, inspect: async () => null, precheck: async () => null,
  apply: async () => { throw new Error("apply() is never reached: the apply port is a spy"); },
};

/** Builds hooks with spy seams; every injected dependency records what it was handed. */
async function fixture(options: { staged?: boolean } = {}) {
  const bundleRepo = new InMemoryPublishContentBundleRepo();
  if (options.staged !== false) await bundleRepo.save({ record: stagedBundle() });
  const registry = createPublishContentTypeRegistry<Ports>();
  registry.register({ contributor: { entityType: ENTITY_TYPE, dependsOn: [], build: () => handler } });
  const calls = { hashed: [] as unknown[], catalogBuilds: 0, order: [] as string[], applied: [] as Array<Record<string, unknown>> };
  const clock = { nowMs: () => Date.parse("2026-09-20T12:00:00.000Z") };
  const idGen = { newId: () => "restore-1" };
  const input: BuildPublishContentImportHooksInput<Ports> = {
    workspaceId: WORKSPACE_ID, bundleId: BUNDLE_ID, actorId: ACTOR_ID, actor: { id: ACTOR_ID, kind: "user" }, clock, idGen,
    publishContentDeps: { workspaceId: WORKSPACE_ID, clock, idGen, ports: {} },
    catalog: { build: (args) => { calls.catalogBuilds += 1; return registry.buildCatalog(args); } },
    planHashOf: ({ details }) => { calls.hashed.push(details); return `injected-hash:${details.rows.length}`; },
    resolveActorClassIdentity: async ({ principalId, principalKind }) => `audit:${principalKind}:${principalId}`,
    bundleRepo, baselineRepo: new InMemoryPublishContentBaselineRepo(), blobStore: { exists: async () => true },
    dbOps: { captureRestorePoint: async () => { calls.order.push("capture"); return { artifactRef: "artifact-1", watermarkAtCapture: 7 }; } },
    restorePointsRepo: { save: async (row) => { calls.order.push(`save:${row.createdBy}:${row.trigger}`); } },
    applyPort: { applyReport: async (args) => {
      calls.order.push("apply");
      calls.applied.push({ ...args });
      return { runId: "run-1", changeSetIds: [], retiredChangeSetIds: [], repointChangeSetIds: [], menuLinksUpdated: 0, menuLinksNotUpdated: [], verificationProblems: [] };
    } },
  };
  return { hooks: buildPublishContentImportHooks(input), calls };
}

describe("buildPublishContentImportHooks", () => {
  // Pin for mutation `plan-hash-not-injected`: the token-bound hash is exactly the injected function's
  // output for the report this very call planned — never an engine-chosen hash.
  it("binds the plan hash to the injected planHashOf over the planned report", async () => {
    const { hooks, calls } = await fixture();
    const { planHash, details } = await hooks.computePlan({});
    expect(details.rows.map((row) => `${row.entityType}:${row.entityId}`)).toEqual([`${ENTITY_TYPE}:${ENTITY_ID}`]);
    expect(planHash).toBe("injected-hash:1");
    expect(calls.hashed).toHaveLength(1);
    expect(calls.hashed[0]).toBe(details);
  });

  // Pin for mutation `actor-identity-hardcoded`: the audit identity is whatever the injected resolver says.
  it("records the actor identity from the injected resolveActorClassIdentity", async () => {
    const { hooks } = await fixture();
    await expect(hooks.resolveActorClassIdentity({ principalId: ACTOR_ID, principalKind: "user" })).resolves.toBe(`audit:user:${ACTOR_ID}`);
    expect(hooks.domain).toBe("publish_content.import");
    expect(hooks.readPermission).toBe("publish_content.read");
    expect(hooks.mutatePermission).toBe("publish_content.apply");
    expect(hooks.scopeId).toBe(WORKSPACE_ID);
  });

  it("reads the injected catalog fresh on every plan", async () => {
    const { hooks, calls } = await fixture();
    await hooks.computePlan({});
    await hooks.computePlan({});
    expect(calls.catalogBuilds).toBe(2);
  });

  it("refuses an unstaged or expired bundle as not found", async () => {
    const { hooks } = await fixture({ staged: false });
    await expect(hooks.computePlan({})).rejects.toBeInstanceOf(PublishContentBundleNotFoundError);
  });

  it("captures the restore point before applying exactly the verified report", async () => {
    const { hooks, calls } = await fixture();
    const { planHash, details } = await hooks.computePlan({});
    const result = await hooks.executeMutation({ planHash, details } as Parameters<typeof hooks.executeMutation>[0]);
    expect(calls.order).toEqual(["capture", `save:${ACTOR_ID}:publish-content-import`, "apply"]);
    expect(calls.applied[0]?.report as PublishContentReport).toBe(details);
    expect(calls.applied[0]).toMatchObject({ principalId: ACTOR_ID, bundleId: BUNDLE_ID, restorePointId: "restore-1" });
    expect(result).toMatchObject({ restorePointId: "restore-1", runId: "run-1" });
  });
});
