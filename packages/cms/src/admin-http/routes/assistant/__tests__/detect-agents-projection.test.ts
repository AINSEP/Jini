import assert from "node:assert/strict";
import { test } from "vitest";

import type { DetectedAgent } from "@jini-ai/core/contracts/site/agent-runtime";

import { toExecutionTabAgent } from "../detect-agents.js";

/**
 * @file `toExecutionTabAgent` is the projection from `@jini-ai/agent-runtime`'s `DetectedAgent`
 * onto `@jini-ai/ui`'s. It is a hand-written field list, which is exactly the shape that drifts:
 * detection pays to discover a field, the projection forgets to carry it, and the card renders
 * nothing with no error anywhere.
 *
 * That had already happened to both reasoning-effort fields. `LocalCliAgentCard` has rendered a
 * "Reasoning effort" control for any agent reporting `reasoningOptions` since it was ported, and
 * `claude`/`codex` have declared those options for just as long — but this function dropped them,
 * so the control was unreachable in the host for every runtime. These tests pin both fields to the
 * projection so a future narrowing fails here instead of silently in the UI.
 *
 * Exported for this test the same way `resolveTestAgentOutcome` was extracted for its own (see
 * that file's header): the route itself needs a real PATH scan and a real DB, neither of which a
 * field-projection assertion should have to stand up.
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

test("toExecutionTabAgent forwards reasoningOptions, so a flag-based runtime's effort picker is reachable", () => {
  const projected = toExecutionTabAgent({ agent: buildAgent({
      id: "claude",
      name: "Claude Code",
      reasoningOptions: [
        { id: "default", label: "Default" },
        { id: "high", label: "High" },
        { id: "max", label: "Max" },
      ],
    }) });
  assert.deepEqual(projected.reasoningOptions, [
    { id: "default", label: "Default" },
    { id: "high", label: "High" },
    { id: "max", label: "Max" },
  ]);
});

test("toExecutionTabAgent forwards reasoningInModelId, so the card can derive per-base-model effort levels", () => {
  const projected = toExecutionTabAgent({ agent: buildAgent({
      id: "antigravity",
      name: "Antigravity",
      reasoningInModelId: {
        levels: [
          { id: "high", label: "High" },
          { id: "medium", label: "Medium" },
          { id: "low", label: "Low" },
        ],
      },
    }) });
  assert.deepEqual(projected.reasoningInModelId, {
    levels: [
      { id: "high", label: "High" },
      { id: "medium", label: "Medium" },
      { id: "low", label: "Low" },
    ],
  });
});

test("toExecutionTabAgent omits both reasoning fields entirely for a runtime that declares neither", () => {
  const projected = toExecutionTabAgent({ agent: buildAgent() });
  assert.equal("reasoningOptions" in projected, false);
  assert.equal("reasoningInModelId" in projected, false);
});

test("toExecutionTabAgent forwards a model's own reasoning levels when the runtime reports them", () => {
  const projected = toExecutionTabAgent({ agent: buildAgent({
      id: "codex",
      name: "Codex",
      models: [
        {
          id: "gpt-5.5",
          label: "GPT-5.5",
          reasoning: [
            { id: "low", label: "Low" },
            { id: "xhigh", label: "Extra high" },
          ],
        },
      ],
    }) });
  assert.deepEqual(projected.models, [
    {
      id: "gpt-5.5",
      label: "GPT-5.5",
      reasoning: [
        { id: "low", label: "Low" },
        { id: "xhigh", label: "Extra high" },
      ],
    },
  ]);
});

test("toExecutionTabAgent leaves a model's reasoning field ABSENT, not [], when the runtime reports none", () => {
  const projected = toExecutionTabAgent({ agent: buildAgent({
      id: "claude",
      name: "Claude Code",
      models: [{ id: "claude-opus-5", label: "Claude Opus 5" }],
    }) });
  // `undefined` here means "this runtime doesn't report per-model levels" — a defaulted `[]` would
  // misreport that as "this model supports zero levels", the exact defect this projection has
  // already reintroduced twice for its other two reasoning fields.
  const [model] = projected.models ?? [];
  assert.ok(model);
  assert.equal("reasoning" in model, false);
});

test("toExecutionTabAgent still carries the model list and its provenance alongside the reasoning fields", () => {
  const projected = toExecutionTabAgent({ agent: buildAgent({
      models: [{ id: "gemini-3.1-pro-high", label: "Gemini 3.1 Pro (High)" }],
      modelsSource: "live",
      reasoningInModelId: { levels: [{ id: "high", label: "High" }] },
    }) });
  // The derivation is over `models`, so a payload carrying the vocabulary but not the catalog
  // would render an effort control with nothing to derive from.
  assert.deepEqual(projected.models, [{ id: "gemini-3.1-pro-high", label: "Gemini 3.1 Pro (High)" }]);
  assert.equal(projected.modelsSource, "live");
  assert.ok(projected.reasoningInModelId);
});

test("toExecutionTabAgent preserves the entire available agent catalog and sign-in guidance", () => {
  const projected = toExecutionTabAgent({ agent: buildAgent({
    id: "codex", name: "Codex", available: true, version: "1.2.3", path: "/usr/local/bin/codex",
    authStatus: "ok", authMessage: "Signed in", modelsSource: "live",
    models: [{ id: "model-pro", label: "Model Pro", reasoning: [{ id: "high", label: "High" }] }],
    reasoningOptions: [{ id: "high", label: "High" }], reasoningInModelId: { levels: [{ id: "high", label: "High" }] },
  }) });
  assert.deepEqual(projected, {
    id: "codex", label: "Codex", installed: true, version: "1.2.3", path: "/usr/local/bin/codex",
    authStatus: "ok", authMessage: "Signed in", modelsSource: "live",
    models: [{ id: "model-pro", label: "Model Pro", reasoning: [{ id: "high", label: "High" }] }],
    reasoningOptions: [{ id: "high", label: "High" }], reasoningInModelId: { levels: [{ id: "high", label: "High" }] },
  });
});

test("toExecutionTabAgent reports an unavailable agent and preserves missing-auth guidance", () => {
  assert.deepEqual(toExecutionTabAgent({ agent: buildAgent({
    id: "claude", name: "Claude Code", available: false, authStatus: "missing", authMessage: "Run claude login",
  }) }), { id: "claude", label: "Claude Code", installed: false, modelsSource: "fallback", authStatus: "missing", authMessage: "Run claude login" });
});

test("empty optional discovery collections stay absent rather than claiming reported support", () => {
  const result = toExecutionTabAgent({ agent: buildAgent({
    models: [], modelsSource: undefined, reasoningOptions: [], reasoningInModelId: { levels: [] },
    version: "", path: "", authStatus: undefined, authMessage: "",
  }) });
  assert.deepEqual(result, { id: "test-cli", label: "Test CLI", installed: true });
});

test("a model with no reported effort levels retains its identity without a reasoning claim", () => {
  const result = toExecutionTabAgent({ agent: buildAgent({ models: [{ id: "plain", label: "Plain", reasoning: [] }], modelsSource: undefined }) });
  assert.deepEqual(result, { id: "test-cli", label: "Test CLI", installed: true, models: [{ id: "plain", label: "Plain" }] });
});
