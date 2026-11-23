import { describe, expect, it } from "vitest";
import type { DetectedAgent } from "@jini-ai/core/contracts/site/agent-runtime";

import { detectAgentsRoute, type DetectAgentsRouteDeps } from "../detect-agents.js";
import { PERMISSION, PREFIX, PRINCIPAL, raw, recordingAuthorize, refusal, signal } from "./helpers.js";

const AGENT = { id: "codex", name: "Codex", bin: "codex", versionArgs: ["--version"], available: true, version: "1.2.3",
  models: [{ id: "gpt-5", label: "GPT-5" }], modelsSource: "live" } as unknown as DetectedAgent;

/** Fake detection: records each read's input and the order of reads vs. the pending sample. */
function detectionDeps(overrides: Partial<DetectAgentsRouteDeps> = {}) {
  const events: unknown[] = [];
  const deps: DetectAgentsRouteDeps = {
    adminAssistantPermission: PERMISSION,
    readDetectedAgents: async (input) => { events.push(["read", input]); return [AGENT]; },
    isDiscoveryPending: () => { events.push("pending"); return true; },
    ...overrides,
  };
  return { deps, events };
}

describe("detectAgentsRoute", () => {
  const call = (input: unknown, deps: DetectAgentsRouteDeps, authorize = recordingAuthorize().authorize) =>
    detectAgentsRoute.handle({ input, deps, context: PRINCIPAL, authorize }, { signal });

  it("pins method and path; parse hands the raw body to the handler", () => {
    expect([detectAgentsRoute.method, detectAgentsRoute.path, detectAgentsRoute.maxBodyBytes]).toEqual(["post", `${PREFIX}/execution/detect-agents`, undefined]);
    expect(detectAgentsRoute.parse(raw({ force: true }))).toEqual({ ok: true, value: { force: true } });
  });

  it("authorizes the assistant permission on assistant-execution; a denial probes nothing", async () => {
    const { deps, events } = detectionDeps();
    const denied = recordingAuthorize({ deny: true });
    expect((await refusal(call({ force: true }, deps, denied.authorize))).status).toBe(403);
    expect(denied.calls).toEqual([{ permission: PERMISSION, entityType: "assistant-execution" }]);
    expect(events).toEqual([]);
  });

  it("forces a rescan only for a literal `force: true`, reads the snapshot before sampling pending, and projects each agent", async () => {
    const { deps, events } = detectionDeps();
    expect(await call({ force: true }, deps)).toEqual({ ok: true, value: { data: [{
      id: "codex", label: "Codex", installed: true, version: "1.2.3", models: [{ id: "gpt-5", label: "GPT-5" }], modelsSource: "live", discoveryPending: true,
    }] } });
    await call({ force: "true" }, deps);
    await call(undefined, deps);
    expect(events).toEqual([["read", { force: true }], "pending", ["read", { force: false }], "pending", ["read", { force: false }], "pending"]);
  });

  it("rethrows a detection failure unchanged and fails closed without an authorizer", async () => {
    const { deps } = detectionDeps({ readDetectedAgents: async () => { throw new Error("scan failed"); } });
    await expect(call({}, deps)).rejects.toThrow("scan failed");
    await expect(detectAgentsRoute.handle({ input: {}, deps, context: PRINCIPAL }, { signal })).rejects.toThrow(/no authorizer/);
  });
});
