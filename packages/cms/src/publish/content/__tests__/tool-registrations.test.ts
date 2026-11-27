import { PublishContentBundleNotFoundError } from "../gated-hooks.js";
import { connectDestination, disconnectDestination, PublishTrustConnectError } from "../../trust/connect.js";
import { expect, it, vi } from "vitest";
import { publishContentAgentToolCatalog } from "../agent-tools.js";
import { humanConfirmedHandler, ToolInputError, type HumanConfirmer } from "@jini-ai/core";
import { PlanStaleError } from "@jini-ai/core/gated-mutations";
import { buildPublishContentRegistrations, contributePublishContentTools, requirePublishTrustProvisioning, type PublishContentToolDeps } from "../tool-registrations.js";
import type { ToolExecutionContext } from "@jini-ai/core";
import type { HumanConfirmSpec } from "@jini-ai/core/contracts/site/human-confirm";
import { InMemoryPublishContentBundleRepo } from "../../transfer/index.js";
import { InMemoryPublishContentRunRepo, type PublishContentRunRecord } from "../run-repo.js";
import type { PublishContentOutcomeRow, PublishContentReport } from "../plan-rows.js";
import type { PublishContentPeerRecord } from "../peer-registry.js";
import { COMMITTED_JSON_CODEC, createFileProvisioning } from "../../trust/provisioning.js";
import { PublishTrustHandshakeError } from "../../trust/handshake-error.js";

const ctx = (input: unknown): ToolExecutionContext => {
  // `kind` rides along at runtime as hosts send it; core's `Principal` does not declare it.
  const principal = { id: "agent", kind: "agent" };
  return { executionId: "exec", principal, run: { id: "run" }, input, signal: new AbortController().signal };
};

function fixture(observeDialog?: (dialog: HumanConfirmSpec) => void) {
  const effects: string[] = [];
  const rows = [{ id: "inferred", label: "Live", sealed: null }, { id: "explicit", label: "Other", sealed: {} }];
  const report: Omit<PublishContentReport, "applyOrder"> = { refused: false, refusalReason: null, rows: [] };
  const gateway = {
    plan: vi.fn(async () => ({ details: report, planId: "plan", planHash: "hash" })),
    confirm: vi.fn(async () => { effects.push("confirm"); throw new PlanStaleError({ message: "changed" }); }),
    execute: vi.fn(),
  };
  const pullAndStageFromPeer = vi.fn(async (_required: { input: { peerId: string } }) => ({ bundleId: "bundle", expiresAt: "later", peerLabel: "Live", blobsUnavailable: [], blobsDeferred: [] }));
  const deps = {
    buildPublishContentImportHooks: vi.fn(() => ({})), PublishContentBundleNotFoundError, connectDestination, disconnectDestination, PublishTrustConnectError,
    workspaceId: "w", authorize: async () => ({ allowed: true }), clock: { nowMs: () => Date.parse("2026-11-25T00:00:00Z") }, idGen: { newId: () => "id" },
    catalog: publishContentAgentToolCatalog, listPublishContentContributors: () => [{ entityType: "post" }],
    readinessCopy: { noLiveSite: { summary: "No destination", missing: "No site", nextStep: "Deploy" }, nothingPublishable: { summary: "Empty", missing: "Empty", nextStep: "Add" }, publishesTo: () => "Ready", notConnected: () => ({ summary: "Connect", missing: "Link", nextStep: "Connect" }) },
    publishContentPeerRepo: { listByWorkspace: async () => rows, findById: async ({ id }: { id: string }) => rows.find(row => row.id === id) ?? null },
    pullAndStageFromPeer, refuseUnexpectedKeys: (input: Record<string, unknown>, allowed: readonly string[]) => { if (Object.keys(input).some(key => !allowed.includes(key))) throw new ToolInputError({ message: "unexpected" }); },
    publishContentRunRepo: { save: vi.fn(), findById: async () => ({ phase: "planned", actorId: "agent", peerLabel: "Live" }) },
    publishContentBundleRepo: { findById: async () => ({ sourcePrincipalId: "agent", expiresAt: "2099-01-01T00:00:00Z" }) },
    gateway, gatedMutations: { gatewayDeps: {} }, dbOps: { getCapabilities: vi.fn() },
    // The real core wrapper: only a `humanConfirmedHandler` passes the registration gate, and it
    // hands `run` the invoking principal as a `user` confirmer. The fake human always says yes.
    humanConfirmedToolHandler: (_surfaces: unknown, spec: { prepare: (r: { ctx: ToolExecutionContext }) => Promise<unknown>; dialog: (prepared: unknown) => HumanConfirmSpec; run: (r: { ctx: ToolExecutionContext; prepared: unknown; confirmer: HumanConfirmer }) => Promise<unknown> }) => humanConfirmedHandler({
      prepare: spec.prepare,
      askHuman: async ({ prepared }) => {
        if (observeDialog) observeDialog(spec.dialog(prepared));
        effects.push("approval");
        return { confirmed: true };
      },
      run: spec.run,
    }),
    isPluginHookFailedError: () => false,
  } as unknown as PublishContentToolDeps;
  const registrations = buildPublishContentRegistrations({ routeDeps: deps, surfaces: { surfaceExchanges: {} as never } });
  const handler = (name: string) => registrations.find(row => row.descriptor.id === name)!.handler;
  return { deps, rows, effects, handler, pullAndStageFromPeer, gateway };
}

it("uses an explicit saved destination before the inferred connected destination", async () => {
  const f = fixture();
  await f.handler("publish_content_plan_pull")(ctx({ peerId: "explicit" }));
  await f.handler("publish_content_plan_pull")(ctx({}));
  expect(f.pullAndStageFromPeer.mock.calls.map(([input]) => input.input.peerId)).toEqual(["explicit", "inferred"]);
});

it("reports the no-destination readiness result", async () => {
  const f = fixture(); f.rows.splice(0);
  expect(await f.handler("publish_content_status")(ctx({}))).toEqual({ ready: false, verdict: "no-live-site", summary: "No destination", missing: "No site", nextStep: "Deploy" });
});

it("rechecks a pull after approval and refuses a changed plan without execution", async () => {
  const f = fixture();
  await expect(f.handler("publish_content_execute_pull")(ctx({ bundleId: "bundle" }))).rejects.toThrow("The local content changed after the dialog was shown.");
  expect(f.effects).toEqual(["approval", "confirm"]);
  expect(f.gateway.execute).not.toHaveBeenCalled();
  expect(f.deps.dbOps.getCapabilities).not.toHaveBeenCalled();
});

it.each([
  { input: {}, reason: "No live destination is connected. Connect this computer with publish_content_connect, then plan the pull again." },
  { input: { peerId: 7 }, reason: "'peerId' must be a non-empty string when provided." },
  { input: { peerId: "missing" }, reason: "The saved destination 'missing' was not found. Choose a saved peerId or connect the live site again." },
])("refuses an unresolvable pull selection before staging ($reason)", async ({ input, reason }) => {
  const f = fixture();
  f.rows.splice(0);
  await expect(f.handler("publish_content_plan_pull")(ctx(input))).rejects.toThrow(new ToolInputError({ message: reason }));
  expect(f.pullAndStageFromPeer).not.toHaveBeenCalled();
  expect(f.gateway.plan).not.toHaveBeenCalled();
});

it("refuses an ambiguous set of connected destinations, listing their exact saved IDs", async () => {
  const f = fixture();
  f.rows.splice(1, 1, { id: "second", label: "Other live", sealed: null });
  await expect(f.handler("publish_content_plan_pull")(ctx({}))).rejects.toThrow(new ToolInputError({
    message: "Several destinations are saved. Choose a peerId: inferred (Live), second (Other live).",
  }));
  expect(f.pullAndStageFromPeer).not.toHaveBeenCalled();
});

it("saves the exact staging scope and returns actionable connect copy without calling an unwired provisioner", async () => {
  const f = fixture();
  const result = await f.handler("publish_content_plan_pull")(ctx({ peerId: "explicit" }));
  expect(result).toEqual({ bundleId: "bundle", expiresAt: "later", peerLabel: "Live",
    counts: { create: 0, update: 0, unchanged: 0, blocked: 0 }, conflicts: [], blobsUnavailable: [], blobsDeferred: [] });
  expect(f.pullAndStageFromPeer).toHaveBeenCalledExactlyOnceWith({ deps: f.deps, input: { peerId: "explicit", principalId: "agent" } });
  expect(f.deps.publishContentRunRepo.save).toHaveBeenCalledExactlyOnceWith({ record: {
    id: "bundle", workspaceId: "w", direction: "import", phase: "planned", peerPrincipalId: "agent", peerLabel: "Live",
    actorId: "agent", restorePointId: null, changeSetIdsJson: null, startedAt: "2026-11-25T00:00:00.000Z", finishedAt: null,
    reportJson: '{"refused":false,"refusalReason":null,"rows":[]}', itemsJson: null,
  } });
  expect(await f.handler("publish_content_connect")(ctx({}))).toEqual({
    connected: false, message: "There is no live site to publish to yet.",
    nextStep: "Put this site online once, then come back and connect this computer to it.",
  });
  expect(await f.handler("publish_content_connect")(ctx({ siteUrl: "not an address" }))).toEqual({
    connected: false, message: "That does not look like a website address.", nextStep: null,
  });
  await expect(f.handler("publish_content_connect")(ctx({ siteUrl: 12 }))).rejects.toThrow(
    new ToolInputError({ message: "'siteUrl' must be a website address as a string when provided" }),
  );
  expect(() => requirePublishTrustProvisioning({ deps: {} })).toThrow("Publishing settings are not set up on this computer yet.");
});

it.each([true, false])("uses the contributed host audit only when ready (%s)", async ready => {
  const f = fixture();
  const gaps = [{ label: "Notes", count: 2, lastReason: "Unsupported by normal publish", lastAt: "2026-11-25T00:00:00Z" }];
  const readGaps = vi.fn(async () => gaps);
  const buildPublishContentDeps = vi.fn(() => ({
    workspaceId: f.deps.workspaceId, clock: f.deps.clock, idGen: f.deps.idGen, ports: {},
    backstop: { coveredTables: [], coveredRoots: [], audit: {
      ready: async () => ready, gaps: readGaps, save: vi.fn(), get: async () => null,
    } },
  }));
  const contributor = contributePublishContentTools({ buildPublishContentDeps });
  const registrations = contributor.build(f.deps, { surfaceExchanges: {} as never });
  const handler = registrations.find(registration => registration.descriptor.id === "publish_backstop_gaps")!.handler;
  expect(await handler(ctx({}))).toEqual({ gaps: ready ? gaps : [] });
  expect(buildPublishContentDeps).toHaveBeenCalledExactlyOnceWith(f.deps);
  expect(readGaps.mock.calls).toEqual(ready ? [[{ workspaceId: "w" }]] : []);
});

const plannedRun: PublishContentRunRecord = {
  id: "bundle", workspaceId: "w", direction: "import", peerPrincipalId: "agent", peerLabel: null,
  phase: "planned", restorePointId: null, changeSetIdsJson: null, actorId: "agent", startedAt: "2026-11-25T00:00:00Z",
  finishedAt: null, reportJson: null, itemsJson: null,
};

async function savedPull(f: ReturnType<typeof fixture>, options: { sourcePrincipalId?: string; expiresAt?: string; audit?: PublishContentRunRecord | null } = {}) {
  const bundles = new InMemoryPublishContentBundleRepo();
  const runs = new InMemoryPublishContentRunRepo();
  f.deps.publishContentBundleRepo = bundles;
  f.deps.publishContentRunRepo = runs;
  await bundles.save({ record: {
    id: "bundle", workspaceId: "w", sourcePrincipalId: options.sourcePrincipalId ?? "agent", artifactFormatVersion: 1,
    hashVersion: 1, entitiesJson: "[]", blobManifestJson: "[]", sizeBytes: 4, receivedAt: "2026-11-24T18:00:00Z",
    expiresAt: options.expiresAt ?? "2026-11-25T18:00:00Z",
  } });
  const audit = options.audit === undefined ? plannedRun : options.audit;
  if (audit !== null) await runs.save({ record: audit });
  return runs;
}

it.each([
  { scenario: "expired staging", options: { expiresAt: "2026-11-24T23:59:59Z" }, differentCaller: false },
  { scenario: "different staging owner", options: { sourcePrincipalId: "another-agent" }, differentCaller: true },
  { scenario: "missing audit", options: { audit: null }, differentCaller: false },
  { scenario: "already applied audit", options: { audit: { ...plannedRun, phase: "applied" as const } }, differentCaller: false },
  { scenario: "different audit owner", options: { audit: { ...plannedRun, actorId: "another-agent" } }, differentCaller: false },
])("refuses $scenario before building a plan or asking for approval", async ({ options, differentCaller }) => {
  const f = fixture();
  await savedPull(f, options);
  const message = differentCaller
    ? "This pull was planned by a different caller. Run publish_content_plan_pull for this conversation."
    : "This pull plan was not found or has expired. Run publish_content_plan_pull again.";
  await expect(f.handler("publish_content_execute_pull")(ctx({ bundleId: "bundle" })))
    .rejects.toSatisfy((error: unknown) => error instanceof ToolInputError && error.message === message);
  expect(f.gateway.plan).not.toHaveBeenCalled();
  expect(f.effects).toEqual([]);
});

const forcedPage: PublishContentOutcomeRow = {
  entityType: "page", entityId: "incoming", entityLabel: "Incoming page", outcome: "forced", writes: true,
  reason: "Selected to replace the existing page", canOverwrite: false,
  retires: { entityType: "page", entityId: "old-holder", entityLabel: null, hash: "previous" },
};

it("rejects a selected overwrite not present in the re-derived plan", async () => {
  const f = fixture();
  await savedPull(f);
  f.gateway.plan.mockResolvedValueOnce({ planId: "fresh", planHash: "fresh-hash", details: { refused: false, refusalReason: null, rows: [forcedPage] } });
  await expect(f.handler("publish_content_execute_pull")(ctx({ bundleId: "bundle", overwriteEntityKeys: ["page:missing"] })))
    .rejects.toSatisfy((error: unknown) => error instanceof ToolInputError &&
      error.message === "'page:missing' is not in this pull plan. Use entity keys returned by publish_content_plan_pull.");
  expect(f.gateway.confirm).not.toHaveBeenCalled();
  expect(f.effects).toEqual([]);
});

it.each(["applied report", "missing report", "unavailable backup"] as const)("keeps the reviewed pull and its workspace scoped through %s", async scenario => {
  const dialogs: HumanConfirmSpec[] = [];
  const f = fixture(dialog => dialogs.push(dialog));
  const runs = await savedPull(f);
  const report: PublishContentReport = { refused: false, refusalReason: null, applyOrder: ["page"], rows: [forcedPage] };
  f.gateway.plan.mockResolvedValueOnce({ planId: "fresh", planHash: "fresh-hash", details: report });
  const confirm = vi.fn<PublishContentToolDeps["gateway"]["confirm"]>(async () => ({
    confirmationToken: "human-token", planHash: "fresh-hash", scopeId: "bundle", confirmerPrincipalId: "owner", status: "minted",
    createdAt: "2026-11-25T00:00:00Z", expiresAt: "2026-11-25T00:05:00Z",
  }));
  f.deps.gateway = { ...f.deps.gateway, confirm };
  f.deps.dbOps.getCapabilities = async () => ({ restorePoint: { costClass: scenario === "unavailable backup" ? "unavailable" : "cheap" } });
  const appliedReport: PublishContentReport = { ...report, rows: [{ ...forcedPage, outcome: "blocked", writes: false, reason: "The destination changed" }] };
  f.gateway.execute.mockImplementation(async () => {
    if (scenario === "applied report") await runs.save({ record: { ...plannedRun, id: "applied", phase: "applied", reportJson: JSON.stringify(appliedReport) } });
    return { runId: "applied" };
  });
  const call = ctx({ bundleId: "bundle", overwriteEntityKeys: ["page:incoming"] });
  const pending = f.handler("publish_content_execute_pull")(call);
  if (scenario === "applied report") {
    expect(await pending).toEqual({ executed: true, counts: { create: 0, update: 0, unchanged: 0, blocked: 1 }, entities: [
      { entityKey: "page:incoming", title: "Incoming page", outcome: "blocked", reason: "The destination changed" },
    ] });
  } else {
    const message = scenario === "missing report"
      ? "The pull ran, but its report could not be loaded. Check import history before retrying."
      : "This computer cannot capture a restore point. Pulling content is refused until backups are available.";
    await expect(pending).rejects.toSatisfy((error: unknown) => error instanceof ToolInputError && error.message === message);
  }
  expect(dialogs).toHaveLength(1);
  expect(dialogs[0]?.details).toEqual([
    { label: "Live site", value: "Live site" }, { label: "Create", value: "0" }, { label: "Update", value: "1" },
    { label: "Unchanged", value: "0" }, { label: "Blocked", value: "0" },
    { label: "Overwrite local item", value: "Incoming page" }, { label: "Move to Trash", value: "old-holder" },
  ]);
  expect(f.deps.buildPublishContentImportHooks).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    workspaceId: "w", bundleId: "bundle", actor: { id: "agent", kind: "agent" }, forcedEntityKeys: new Set(["page:incoming"]),
  }));
  const expected = { deps: f.deps.gatedMutations.gatewayDeps, hooks: {}, signal: call.signal };
  expect(confirm).toHaveBeenCalledExactlyOnceWith({ ...expected, principalId: "agent", principalKind: "user", planId: "fresh", planHash: "fresh-hash" });
  if (scenario === "unavailable backup") expect(f.gateway.execute).not.toHaveBeenCalled();
  else expect(f.gateway.execute).toHaveBeenCalledExactlyOnceWith({ ...expected, principalId: "agent", principalKind: "agent", confirmationToken: "human-token" });
});

it("publishes the supplied selection as the current agent and treats absent input as the default scope", async () => {
  const f = fixture();
  const send = vi.fn<PublishContentToolDeps["publishContentFromTool"]>(async () => ({ published: true, runId: "live-run" }));
  f.deps.publishContentFromTool = send;
  const handler = f.handler("publish_content_publish");
  const selected = { peerId: "explicit", items: ["page:landing"], overwrite: false };
  expect(await handler(ctx(selected))).toEqual({ published: true, runId: "live-run" });
  expect(await handler(ctx(undefined))).toEqual({ published: true, runId: "live-run" });
  expect(send.mock.calls).toEqual([[{ deps: f.deps, principalId: "agent" }, selected], [{ deps: f.deps, principalId: "agent" }, {}]]);
});

it("does not forward an already cancelled publish request to the remote write port", async () => {
  const f = fixture();
  const send = vi.fn<PublishContentToolDeps["publishContentFromTool"]>(async () => ({ published: true }));
  f.deps.publishContentFromTool = send;
  const controller = new AbortController();
  const cancelled = new Error("caller cancelled the publish");
  controller.abort(cancelled);
  await expect(f.handler("publish_content_publish")({ ...ctx({ items: ["page:landing"] }), signal: controller.signal })).rejects.toBe(cancelled);
  expect(send).not.toHaveBeenCalled();
});

function connectionFixture() {
  const f = fixture();
  const peers = new Map<string, PublishContentPeerRecord>();
  f.deps.publishContentPeerRepo.listByWorkspace = async ({ workspaceId }) => [...peers.values()].filter(peer => peer.workspaceId === workspaceId);
  f.deps.publishContentPeerRepo.insert = async ({ record }) => { peers.set(record.id, record); };
  f.deps.publishTrustProvisioning = createFileProvisioning({ codec: COMMITTED_JSON_CODEC, path: "/fixture/publish-trust.json", io: {
    read: async () => null, write: async () => { throw new Error("unexpected real provisioning write"); },
  } });
  return f;
}

it("connects the normalized destination with only the registered ordinary types and persists its remote workspace", async () => {
  const f = connectionFixture();
  const target = { kind: "test", path: "/fixture/publish-trust.json", nextStep: "Commit and deploy." };
  const connect = vi.fn<PublishContentToolDeps["connectDestination"]>(async () => ({
    identity: { installationId: "live-install", workspaceId: "live-workspace", origin: "https://store.example" },
    baseUrl: "https://store.example", changed: true, target, nextStep: "INTERNAL_PROVISIONING_STEP",
  }));
  f.deps.connectDestination = connect;
  f.deps.listPublishContentContributors = () => ["page", "raw-row", "media"].map(entityType => ({ entityType }));
  expect(await f.handler("publish_content_connect")(ctx({ siteUrl: " https://store.example/ " }))).toEqual({
    connected: true, message: "This computer publishes to store.example.", nextStep: "Put this site online once more for the change to take effect.",
  });
  expect(connect).toHaveBeenCalledExactlyOnceWith({
    deps: expect.objectContaining({ workspaceId: "w", provisioning: f.deps.publishTrustProvisioning, clock: f.deps.clock }),
    input: { baseUrl: "https://store.example", entityTypes: ["page", "media"] },
  });
  expect(await f.deps.publishContentPeerRepo.listByWorkspace({ workspaceId: "w" })).toEqual([{
    id: "id", workspaceId: "w", label: "store.example", baseUrl: "https://store.example", remoteWorkspaceId: "live-workspace",
    sealed: null, masked: null, aadVersion: 1, createdAt: "2026-11-25T00:00:00.000Z", updatedAt: "2026-11-25T00:00:00.000Z",
  }]);
});

it.each([
  { scenario: "handshake refusal", error: new PublishTrustHandshakeError({ failure: "refused", message: "SIGNATURE_MISSING" }),
    message: "store.example could not be reached, or it is not a site this can publish to.", nextStep: "Check the address and that the site is online, then try connecting again." },
  { scenario: "provisioning refusal", error: new PublishTrustConnectError({ message: "driver detail" }),
    message: "This site's publishing settings could not be saved on this computer.", nextStep: "Check that this project's files can be written to, then try connecting again." },
])("gives safe connect guidance for $scenario without saving a peer", async ({ error, message, nextStep }) => {
  const f = connectionFixture();
  f.deps.connectDestination = async () => { throw error; };
  expect(await f.handler("publish_content_connect")(ctx({ siteUrl: "https://store.example" }))).toEqual({ connected: false, message, nextStep });
  expect(await f.deps.publishContentPeerRepo.listByWorkspace({ workspaceId: "w" })).toEqual([]);
});
