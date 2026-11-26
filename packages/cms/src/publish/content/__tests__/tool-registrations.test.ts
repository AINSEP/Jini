import { buildPublishContentImportHooks, PublishContentBundleNotFoundError } from "../gated-hooks.js";
import { connectDestination, disconnectDestination, PublishTrustConnectError } from "../../trust/connect.js";
import { expect, it, vi } from "vitest";
import { publishContentAgentToolCatalog } from "../agent-tools.js";
import { ToolInputError } from "@jini-ai/core";
import { PlanStaleError } from "@jini-ai/core/gated-mutations";
import { buildPublishContentRegistrations, type PublishContentToolDeps } from "../tool-registrations.js";
import type { ToolExecutionContext } from "@jini-ai/core";

const gateway = vi.hoisted(() => ({ plan: vi.fn(), confirm: vi.fn(), execute: vi.fn() }));
vi.mock("@jini-ai/core/gated-mutations", async importOriginal => ({ ...await importOriginal<object>(), ...gateway }));
vi.mock("../gated-hooks.js", async importOriginal => ({ ...await importOriginal<object>(), buildPublishContentImportHooks: vi.fn(() => ({})) }));

const ctx = (input: unknown): ToolExecutionContext => {
  // `kind` rides along at runtime as hosts send it; core's `Principal` does not declare it.
  const principal = { id: "agent", kind: "agent" };
  return { executionId: "exec", principal, run: { id: "run" }, input, signal: new AbortController().signal };
};

function fixture() {
  const effects: string[] = [];
  const rows = [{ id: "inferred", label: "Live", sealed: null }, { id: "explicit", label: "Other", sealed: {} }];
  const report = { refused: false, refusalReason: null, rows: [] };
  gateway.plan.mockResolvedValue({ details: report, planId: "plan", planHash: "hash" });
  gateway.confirm.mockImplementation(async () => { effects.push("confirm"); throw new PlanStaleError({ message: "changed" }); });
  gateway.execute.mockClear();
  const pullAndStageFromPeer = vi.fn(async (_required: { input: { peerId: string } }) => ({ bundleId: "bundle", expiresAt: "later", peerLabel: "Live", blobsUnavailable: [], blobsDeferred: [] }));
  const deps = {
    buildPublishContentImportHooks, PublishContentBundleNotFoundError, connectDestination, disconnectDestination, PublishTrustConnectError,
    workspaceId: "w", authorize: async () => ({ allowed: true }), clock: { nowMs: () => Date.parse("2026-11-25T00:00:00Z") }, idGen: { newId: () => "id" },
    catalog: publishContentAgentToolCatalog, listPublishContentContributors: () => [{ entityType: "post" }],
    readinessCopy: { noLiveSite: { summary: "No destination", missing: "No site", nextStep: "Deploy" }, nothingPublishable: { summary: "Empty", missing: "Empty", nextStep: "Add" }, publishesTo: () => "Ready", notConnected: () => ({ summary: "Connect", missing: "Link", nextStep: "Connect" }) },
    publishContentPeerRepo: { listByWorkspace: async () => rows, findById: async ({ id }: { id: string }) => rows.find(row => row.id === id) ?? null },
    pullAndStageFromPeer, refuseUnexpectedKeys: (input: Record<string, unknown>, allowed: readonly string[]) => { if (Object.keys(input).some(key => !allowed.includes(key))) throw new ToolInputError({ message: "unexpected" }); },
    publishContentRunRepo: { save: vi.fn(), findById: async () => ({ phase: "planned", actorId: "agent", peerLabel: "Live" }) },
    publishContentBundleRepo: { findById: async () => ({ sourcePrincipalId: "agent", expiresAt: "2099-01-01T00:00:00Z" }) },
    gatedMutations: { gatewayDeps: {} }, dbOps: { getCapabilities: vi.fn() },
    humanConfirmedToolHandler: (_surfaces: unknown, spec: { prepare: (r: { ctx: ToolExecutionContext }) => Promise<unknown>; run: (r: { ctx: ToolExecutionContext; prepared: unknown; confirmer: { id: string; kind: string } }) => Promise<unknown> }) => async (context: ToolExecutionContext) => {
      const prepared = await spec.prepare({ ctx: context }); effects.push("approval");
      return spec.run({ ctx: context, prepared, confirmer: { id: "owner", kind: "owner" } });
    },
    isPluginHookFailedError: () => false,
  } as unknown as PublishContentToolDeps;
  const registrations = buildPublishContentRegistrations({ routeDeps: deps, surfaces: { surfaceExchanges: {} as never } });
  const handler = (name: string) => registrations.find(row => row.descriptor.id === name)!.handler;
  return { deps, rows, effects, handler, pullAndStageFromPeer };
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
  expect(gateway.execute).not.toHaveBeenCalled();
  expect(f.deps.dbOps.getCapabilities).not.toHaveBeenCalled();
});
