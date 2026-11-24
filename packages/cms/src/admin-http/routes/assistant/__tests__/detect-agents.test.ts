import { describe, expect, it } from "vitest";

import { assistantDetectAgentsRoute, toExecutionTabAgent } from "../detect-agents.js";
import { agent, PERMISSION, PRINCIPAL, raw, recordingAuthorize, WORKSPACE_ID } from "./execution-helpers.js";

function deps(snapshot = { agents: [agent()], discoveryPending: false }) {
  const forces: boolean[] = [];
  return {
    forces,
    deps: {
      workspaceId: WORKSPACE_ID, manageAssistantPermission: PERMISSION,
      detectAgents: async ({ force }: { force: boolean }) => { forces.push(force); return snapshot; },
    },
  };
}

describe("assistantDetectAgentsRoute", () => {
  it("pins method, path, success status and no body cap", () => {
    expect(assistantDetectAgentsRoute.method).toBe("post");
    expect(assistantDetectAgentsRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/assistant/execution/detect-agents");
    expect(assistantDetectAgentsRoute.successStatus).toBeUndefined();
    expect(assistantDetectAgentsRoute.maxBodyBytes).toBeUndefined();
  });

  it("parses only a strict boolean force:true as a rescan", () => {
    expect(assistantDetectAgentsRoute.parse(raw({ force: true }))).toEqual({ ok: true, value: { force: true } });
    expect(assistantDetectAgentsRoute.parse(raw({ force: "true" }))).toEqual({ ok: true, value: { force: false } });
    expect(assistantDetectAgentsRoute.parse(raw(undefined))).toEqual({ ok: true, value: { force: false } });
  });

  it("authorizes the injected permission on assistant-execution with no entity scope, then projects each agent with the pending flag", async () => {
    const auth = recordingAuthorize();
    const { deps: d, forces } = deps({ agents: [agent({ version: "1.2.3", path: "/bin/a" }), agent({ id: "cli-b", name: "CLI B", available: false })], discoveryPending: true });
    const result = await assistantDetectAgentsRoute.handle({ input: { force: true }, deps: d, context: PRINCIPAL, authorize: auth.authorize });
    expect(auth.calls).toEqual([{ permission: PERMISSION, entityType: "assistant-execution" }]);
    expect(forces).toEqual([true]);
    expect(result).toEqual({ ok: true, value: { data: [
      { id: "cli-a", label: "CLI A", installed: true, version: "1.2.3", path: "/bin/a", discoveryPending: true },
      { id: "cli-b", label: "CLI B", installed: false, discoveryPending: true },
    ] } });
  });

  it("a denied principal never reaches the detector", async () => {
    const { deps: d, forces } = deps();
    await expect(assistantDetectAgentsRoute.handle({ input: { force: false }, deps: d, context: PRINCIPAL, authorize: recordingAuthorize(true).authorize }))
      .rejects.toThrow(`denied ${PERMISSION}`);
    expect(forces).toEqual([]);
  });

  it("rethrows a detector failure unchanged for the host 500, and fails closed without an authorizer", async () => {
    const d = { ...deps().deps, detectAgents: async () => { throw new Error("scan exploded"); } };
    await expect(assistantDetectAgentsRoute.handle({ input: { force: false }, deps: d, context: PRINCIPAL, authorize: recordingAuthorize().authorize }))
      .rejects.toThrow("scan exploded");
    await expect(assistantDetectAgentsRoute.handle({ input: { force: false }, deps: d, context: PRINCIPAL, authorize: undefined as never }))
      .rejects.toThrow(/no authorizer/);
  });
});

describe("toExecutionTabAgent", () => {
  it("carries models with their own reasoning, reasoning vocabularies, provenance and auth guidance", () => {
    expect(toExecutionTabAgent({ agent: agent({
      models: [{ id: "m1", label: "M1", reasoning: [{ id: "low", label: "Low" }] }, { id: "m2", label: "M2" }],
      modelsSource: "live", reasoningOptions: [{ id: "high", label: "High" }],
      reasoningInModelId: { levels: [{ id: "max", label: "Max" }] }, authStatus: "missing", authMessage: "run `a login`",
    }) })).toEqual({
      id: "cli-a", label: "CLI A", installed: true,
      models: [{ id: "m1", label: "M1", reasoning: [{ id: "low", label: "Low" }] }, { id: "m2", label: "M2" }],
      modelsSource: "live", reasoningOptions: [{ id: "high", label: "High" }],
      reasoningInModelId: { levels: [{ id: "max", label: "Max" }] }, authStatus: "missing", authMessage: "run `a login`",
    });
  });

  it("omits every empty collection and absent scalar rather than defaulting it", () => {
    expect(toExecutionTabAgent({ agent: agent({ models: [], reasoningOptions: [], reasoningInModelId: { levels: [] }, version: null }) }))
      .toEqual({ id: "cli-a", label: "CLI A", installed: true });
  });
});
