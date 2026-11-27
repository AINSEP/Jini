import { describe, expect, it } from "vitest";

import { assistantTestAgentRoute } from "../test-agent.js";
import { resolveTestAgentOutcome } from "../execution-shared.js";
import { agent, PERMISSION, PRINCIPAL, raw, recordingAuthorize, refusalOf, WORKSPACE_ID } from "./execution-helpers.js";

function deps(agents = [agent({ authStatus: "ok", version: "2.0" })]) {
  const probes: string[] = [];
  return {
    probes,
    deps: {
      workspaceId: WORKSPACE_ID, manageAssistantPermission: PERMISSION,
      testAgent: async ({ agentId }: { agentId: string }) => { probes.push(agentId); return agents; },
    },
  };
}
const run = (input: { agentId: string; model: string }, d = deps().deps, authorize = recordingAuthorize().authorize) =>
  assistantTestAgentRoute.handle({ input, deps: d, context: PRINCIPAL, authorize });

describe("assistantTestAgentRoute", () => {
  it("pins method, path, success status and no body cap", () => {
    expect(assistantTestAgentRoute.method).toBe("post");
    expect(assistantTestAgentRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/assistant/execution/test-agent");
    expect(assistantTestAgentRoute.successStatus).toBeUndefined();
    expect(assistantTestAgentRoute.maxBodyBytes).toBeUndefined();
  });

  it("parses and trims agentId/model, defaulting absent fields to empty strings", () => {
    expect(assistantTestAgentRoute.parse(raw({ agentId: "  cli-a ", model: " m1 " }))).toEqual({ ok: true, value: { agentId: "cli-a", model: "m1" } });
    expect(assistantTestAgentRoute.parse(raw(undefined))).toEqual({ ok: true, value: { agentId: "", model: "" } });
  });

  it("authorizes before refusing a blank agentId with the flat BAD_REQUEST body", async () => {
    const auth = recordingAuthorize();
    const { deps: d, probes } = deps();
    expect(await refusalOf(() => run({ agentId: "", model: "" }, d, auth.authorize)))
      .toEqual({ status: 400, body: { error: "'agentId' is required", code: "BAD_REQUEST" } });
    expect(auth.calls).toEqual([{ permission: PERMISSION, entityType: "assistant-execution" }]);
    expect(probes).toEqual([]);
  });

  it("a denied principal never reaches the probe", async () => {
    const { deps: d, probes } = deps();
    await expect(run({ agentId: "cli-a", model: "" }, d, recordingAuthorize(true).authorize)).rejects.toThrow(`denied ${PERMISSION}`);
    expect(probes).toEqual([]);
  });

  it("answers the missing-PATH verdict for an absent or unavailable agent", async () => {
    expect(await run({ agentId: "nope", model: "" })).toEqual({ ok: true, value: { ok: false, message: "'nope' was not found on this server's PATH." } });
    expect(await run({ agentId: "cli-a", model: "" }, deps([agent({ available: false })]).deps))
      .toEqual({ ok: true, value: { ok: false, message: "'cli-a' was not found on this server's PATH." } });
  });

  it("probes only the requested id and answers the readiness verdict", async () => {
    const { deps: d, probes } = deps();
    expect(await run({ agentId: "cli-a", model: "" }, d)).toEqual({ ok: true, value: { ok: true, message: "CLI A 2.0 is installed and authenticated." } });
    expect(probes).toEqual(["cli-a"]);
  });

  it("rethrows a probe failure unchanged for the host 500", async () => {
    const d = { ...deps().deps, testAgent: async () => { throw new Error("probe failed"); } };
    await expect(run({ agentId: "cli-a", model: "" }, d)).rejects.toThrow("probe failed");
  });
});

describe("resolveTestAgentOutcome", () => {
  it("covers missing, unknown, model-mismatch and success", () => {
    expect(resolveTestAgentOutcome({ agent: agent({ authStatus: "missing" }), model: "" })).toEqual({ ok: false, message: "CLI A is installed but not authenticated." });
    expect(resolveTestAgentOutcome({ agent: agent({ authStatus: "missing", authMessage: "log in" }), model: "" })).toEqual({ ok: false, message: "log in" });
    expect(resolveTestAgentOutcome({ agent: agent({ authStatus: "unknown", version: "1" }), model: "" }))
      .toEqual({ ok: true, message: "CLI A 1 responded, but its sign-in status could not be verified." });
    expect(resolveTestAgentOutcome({ agent: agent({ authStatus: "ok", models: [{ id: "a", label: "A" }] }), model: "b" })).toEqual({
      ok: false, message: "CLI A is installed and authenticated, but it no longer offers the model 'b'. Pick a different model, or Rescan to refresh the list.",
    });
    expect(resolveTestAgentOutcome({ agent: agent({ authStatus: "ok", models: [{ id: "a", label: "A" }] }), model: "a" }))
      .toEqual({ ok: true, message: "CLI A is installed and authenticated, and offers 'a'." });
  });
});

it("does not reject a selected model when the installed agent reports no model catalog", async () => {
  const { deps: d, probes } = deps([agent({ authStatus: "ok", models: [] })]);
  expect(await run({ agentId: "cli-a", model: "saved-external" }, d))
    .toEqual({ ok: true, value: { ok: true, message: "CLI A is installed and authenticated, and offers 'saved-external'." } });
  expect(probes).toEqual(["cli-a"]);
});

it("without a mount authorizer, the test-agent route never probes the runtime", async () => {
  const { deps: d, probes } = deps();
  await expect(assistantTestAgentRoute.handle({ input: { agentId: "cli-a", model: "m1" }, deps: d, context: PRINCIPAL }))
    .rejects.toThrow(new Error("assistant execution route has no authorizer"));
  expect(probes).toEqual([]);
});
