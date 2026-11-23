import { expect, it } from "vitest";

import type { DetectedAgent } from "@jini-ai/core/contracts/site/agent-runtime";

import { resolveTestAgentOutcome } from "../resolve-test-agent-outcome.js";

/**
 * @file `resolveTestAgentOutcome` is the branch logic `test-agent.ts`'s POST route delegates to
 * once it already has a real `DetectedAgent` in hand (installed/authenticated/model-mismatch/
 * success). Extracted specifically so these branches are testable without a real PATH scan —
 * the host's execution-route test header documents that, before this extraction, only
 * the "agent id not found" branch was host-independent and the rest was an accepted gap (no
 * injectable seam for `detectAgents()`, and Node's `mock.module()` needs
 * `--experimental-test-module-mocks`, which this repo's test scripts do not pass).
 */

function buildAgent(overrides: { [K in keyof DetectedAgent]?: DetectedAgent[K] | undefined } = {}): DetectedAgent {
  return {
    id: "test-cli",
    name: "Test CLI",
    bin: "test-cli",
    versionArgs: ["--version"],
    streamFormat: "text",
    models: [],
    modelsSource: "fallback",
    available: true,
    ...overrides,
  } as DetectedAgent;
}

it("resolveTestAgentOutcome: authStatus 'missing' with an explicit authMessage returns ok:false with that exact message", () => {
  const agent = buildAgent({ authStatus: "missing", authMessage: "Run `test-cli login` first." });
  const result = resolveTestAgentOutcome({ agent, model: "" });
  expect(result.ok).toBe(false);
  expect(result.message).toBe("Run `test-cli login` first.");
});

it("resolveTestAgentOutcome: authStatus 'missing' with no authMessage falls back to a generic not-authenticated message", () => {
  const agent = buildAgent({ authStatus: "missing", authMessage: undefined });
  const result = resolveTestAgentOutcome({ agent, model: "" });
  expect(result.ok).toBe(false);
  expect(result.message).toBe("Test CLI is installed but not authenticated.");
});

it("resolveTestAgentOutcome: authStatus 'unknown' returns ok:true but says sign-in status could not be verified", () => {
  const agent = buildAgent({ authStatus: "unknown", version: "1.2.3" });
  const result = resolveTestAgentOutcome({ agent, model: "some-model" });
  expect(result.ok).toBe(true);
  expect(result.message).toMatch(/could not be verified/);
  expect(result.message).toMatch(/^Test CLI 1\.2\.3/);
});

it("resolveTestAgentOutcome: a requested model absent from the agent's real model list returns ok:false, not silently accepted", () => {
  const agent = buildAgent({
    authStatus: "ok",
    models: [{ id: "model-a", label: "Model A" }, { id: "model-b", label: "Model B" }],
  });
  const result = resolveTestAgentOutcome({ agent, model: "model-zzz-does-not-exist" });
  expect(result.ok).toBe(false);
  expect(result.message).toMatch(/no longer offers the model 'model-zzz-does-not-exist'/);
});

it("resolveTestAgentOutcome: a requested model present in the agent's model list returns ok:true naming it", () => {
  const agent = buildAgent({
    authStatus: "ok",
    version: "2.0.0",
    models: [{ id: "model-a", label: "Model A" }],
  });
  const result = resolveTestAgentOutcome({ agent, model: "model-a" });
  expect(result.ok).toBe(true);
  expect(result.message).toMatch(/is installed and authenticated, and offers 'model-a'/);
});

it("resolveTestAgentOutcome: no model requested returns ok:true with the plain installed-and-authenticated message", () => {
  const agent = buildAgent({ authStatus: "ok", version: "2.0.0" });
  const result = resolveTestAgentOutcome({ agent, model: "" });
  expect(result.ok).toBe(true);
  expect(result.message).toBe("Test CLI 2.0.0 is installed and authenticated.");
});

it("resolveTestAgentOutcome: authStatus undefined (adapter declares no probe result) is treated the same as 'ok'", () => {
  const agent = buildAgent({ authStatus: undefined, version: "9.9.9" });
  const result = resolveTestAgentOutcome({ agent, model: "" });
  expect(result.ok).toBe(true);
  expect(result.message).toBe("Test CLI 9.9.9 is installed and authenticated.");
});

it("resolveTestAgentOutcome: a model requested against an agent with an EMPTY model list is not treated as a mismatch (models?.length guard)", () => {
  // Pins existing behavior carried over unchanged from the route: the mismatch check is gated on
  // `agent.models?.length` being truthy, so an agent that reports no model list at all cannot ever
  // fail the mismatch check — it falls through to the success branch instead.
  const agent = buildAgent({ authStatus: "ok", models: [] });
  const result = resolveTestAgentOutcome({ agent, model: "whatever-model" });
  expect(result.ok).toBe(true);
  expect(result.message).toMatch(/offers 'whatever-model'/);
});
