/**
 * @file The agent-CLI picker inventory (`inventory/index.ts`), driven with
 * hand-written runtime ports: nothing on PATH is probed. Covers which defs are listed, how an
 * installed vs absent CLI is summarized, the sort, and the per-process cache with `rescan`.
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import type { RuntimeAgentDef } from "@jini-ai/core/contracts/agents";
import { orFallback } from "@jini-ai/core/errors/idioms";
import { modelReasoningOptions } from "../../model-discovery-shared.js";

import { createAgentInventory, summarizeAgent, type AgentRuntimePorts } from "../index.js";

function def(id: string, extra: Partial<RuntimeAgentDef> = {}): RuntimeAgentDef {
  return {
    id,
    name: `${id} CLI`,
    bin: id,
    versionArgs: ["--version"],
    fallbackModels: [{ id: `${id}-default`, label: `${id} default` }],
    buildArgs: () => [],
    streamFormat: "plain",
    ...extra,
  };
}

function ports(overrides: Partial<AgentRuntimePorts> = {}): AgentRuntimePorts & { probes: string[] } {
  const probes: string[] = [];
  return {
    probes,
    defs: [],
    resolveLaunch: ({ def: d }) => ({ launchPath: `/usr/local/bin/${d.bin}` }),
    probeModels: async ({ def: d }) => {
      probes.push(d.id);
      return { models: [{ id: `${d.id}-live`, label: "Live", description: "dropped from the summary" }] };
    },
    supportsTools: () => true,
    orFallback,
    ...overrides,
  };
}

test("an installed CLI is summarized with its probed models, reasoning options and custom-model flag", async () => {
  const p = ports();
  const summary = await summarizeAgent({ def: def("claude", {
    reasoningOptions: [{ id: "high", label: "High" }],
    supportsCustomModel: true,
  }), ports: p });
  assert.deepEqual(summary, {
    id: "claude",
    name: "claude CLI",
    available: true,
    version: null,
    models: [{ id: "claude-live", label: "Live" }],
    reasoningOptions: [{ id: "high", label: "High" }],
    supportsCustomModel: true,
  });
});

test("inventory preserves explicit false capability flags as well as true flags", async () => {
  const p = ports({ defs: [def("explicit", { supportsCustomModel: false }), def("omitted")] });
  const summaries = await createAgentInventory(p)({ rescan: false });
  assert.deepEqual(summaries[0], {
    id: "explicit",
    name: "explicit CLI",
    available: true,
    version: null,
    models: [{ id: "explicit-live", label: "Live" }],
    reasoningOptions: [],
    supportsCustomModel: false,
  });
  assert.equal("supportsCustomModel" in summaries[1]!, false);
});

test("a failed model probe falls back to the def's own models rather than failing the list", async () => {
  const p = ports({ probeModels: async () => { throw new Error("probe timed out"); } });
  const summary = await summarizeAgent({ def: def("codex"), ports: p });
  assert.equal(summary.available, true);
  assert.deepEqual(summary.models, [{ id: "codex-default", label: "codex default" }]);
  assert.deepEqual(summary.reasoningOptions, []);
  assert.equal("supportsCustomModel" in summary, false, "an unset flag is omitted, not sent as undefined");
});

test("a failed probe falls back through the host's injected orFallback, labelled with its step", async () => {
  const steps: string[] = [];
  const p = ports({
    probeModels: async () => { throw new Error("probe timed out"); },
    orFallback: (required) => { steps.push(required.step); return orFallback(required); },
  });
  const summary = await summarizeAgent({ def: def("codex"), ports: p });
  assert.deepEqual(steps, ["Probe inventory agent models"]);
  assert.deepEqual(summary.models, [{ id: "codex-default", label: "codex default" }]);
});

test("an absent CLI is never probed, shows its fallbacks, and says why it is unavailable", async () => {
  const p = ports({ resolveLaunch: ({ def: d }) => (d.id === "named" ? { launchPath: null, diagnostic: "named: blocked by policy" } : {}) });
  const named = await summarizeAgent({ def: def("named"), ports: p });
  assert.equal(named.available, false);
  assert.equal(named.diagnostic, "named: blocked by policy");
  assert.deepEqual(named.models, [{ id: "named-default", label: "named default" }]);
  const bare = await summarizeAgent({ def: def("bare"), ports: p });
  assert.equal(bare.diagnostic, "bare CLI CLI not found on PATH");
  assert.deepEqual(p.probes, []);
});

test("the inventory lists only tool-capable runtimes, installed ones first", async () => {
  const p = ports({
    defs: [def("absent"), def("no-mcp"), def("installed")],
    resolveLaunch: ({ def: d }) => ({ launchPath: d.id === "absent" ? null : `/bin/${d.id}` }),
    supportsTools: ({ def: d }) => d.id !== "no-mcp",
  });
  const rows = await createAgentInventory(p)({ rescan: false });
  assert.deepEqual(rows.map((row) => [row.id, row.available]), [["installed", true], ["absent", false]]);
});

test("the inventory probes once per process until a rescan forces a fresh probe", async () => {
  const p = ports({ defs: [def("claude")] });
  const list = createAgentInventory(p);
  const first = await list({ rescan: false });
  const second = await list({ rescan: false });
  assert.equal(second, first, "the cached result itself, not a re-probe");
  assert.deepEqual(p.probes, ["claude"]);
  await list({ rescan: true });
  assert.deepEqual(p.probes, ["claude", "claude"]);
});

test("a failed probe does not poison the cache: the next call probes again", async () => {
  let fail = true;
  const p = ports({
    defs: [def("claude")],
    resolveLaunch: ({ def: d }) => {
      if (fail) throw new Error("PATH unreadable");
      return { launchPath: `/bin/${d.id}` };
    },
  });
  const list = createAgentInventory(p);
  await assert.rejects(list({ rescan: false }), /PATH unreadable/);
  fail = false;
  assert.deepEqual((await list({ rescan: false })).map((row) => row.id), ["claude"]);
});

test("a stale failed probe never clears the newer probe a rescan cached meanwhile", async () => {
  let calls = 0;
  const p = ports({
    defs: [def("claude")],
    resolveLaunch: ({ def: d }) => {
      calls += 1;
      if (calls === 1) throw new Error("first probe failed");
      return { launchPath: `/bin/${d.id}` };
    },
  });
  const list = createAgentInventory(p);
  // Both start before the first one's rejection is observed: the rescan's probe replaces it in the cache.
  const stale = list({ rescan: false });
  const fresh = list({ rescan: true });
  await assert.rejects(stale, /first probe failed/);
  assert.equal(list({ rescan: false }), fresh, "the newer probe stays cached");
  assert.equal(calls, 2, "and no third probe was started");
});

test("inventory metadata preserves model effort choices and suffix ownership for the shared picker", async () => {
  const high = [{ id: "high", label: "High" }];
  const advertised = [{ id: "default", label: "Default" }, { id: "low", label: "Low" }, ...high];
  const models = [
    { id: "narrowed", label: "Narrowed", reasoning: high, description: "not picker metadata" },
    { id: "empty", label: "Empty", reasoning: [] },
    { id: "inherited", label: "Inherited" },
  ];
  const summary = await summarizeAgent({ def: def("effort", { reasoningOptions: advertised }),
    ports: ports({ probeModels: async () => ({ models }) }) });
  assert.deepEqual(summary.models, [
    { id: "narrowed", label: "Narrowed", reasoning: high },
    { id: "empty", label: "Empty", reasoning: [] },
    { id: "inherited", label: "Inherited" },
  ]);
  assert.equal(Object.hasOwn(summary.models[2]!, "reasoning"), false);
  assert.equal(Object.hasOwn(summary, "reasoningInModelId"), false);
  assert.deepEqual(modelReasoningOptions({ agent: summary, model: summary.models[0] }), [advertised[0], ...high]);
  assert.deepEqual(modelReasoningOptions({ agent: summary, model: summary.models[1] }), [advertised[0]]);
  assert.deepEqual(modelReasoningOptions({ agent: summary, model: summary.models[2] }), advertised);

  const suffix = await summarizeAgent({ def: def("suffix", { reasoningInModelId: { levels: high } }),
    ports: ports({ probeModels: async () => ({ models: [models[0]!] }) }) });
  assert.deepEqual(suffix.reasoningInModelId, { levels: high });
  assert.deepEqual(modelReasoningOptions({ agent: suffix, model: suffix.models[0] }), []);
});
