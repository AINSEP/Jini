import assert from "node:assert/strict";
import { test } from "vitest";

import { mergeGlueToolRegistrations } from "../attachment-points/tool-registration.js";
import type { GlueToolModuleContribution } from "../attachment-points/tool-registration.js";
import type { GlueToolRegistration } from "../ports.js";



function registration(toolId: string): GlueToolRegistration {
  return { toolId, handler: () => `handled:${toolId}` };
}

function fakeHostPort(): { hostPort: { registerTools: ({ moduleId, registrations }: { moduleId: string; registrations: readonly GlueToolRegistration[] }) => void }; calls: Array<{ moduleId: string; registrations: readonly GlueToolRegistration[] }> } {
  const calls: Array<{ moduleId: string; registrations: readonly GlueToolRegistration[] }> = [];
  return {
    hostPort: {
      registerTools: ({ moduleId, registrations }: { moduleId: string; registrations: readonly GlueToolRegistration[] }) => {
        calls.push({ moduleId, registrations });
      },
    },
    calls,
  };
}

test("a well-formed glue module registers successfully and calls the host port exactly once", () => {
  const { hostPort, calls } = fakeHostPort();
  const module: GlueToolModuleContribution = { moduleId: "m1", build: () => [registration("glue_tool_a")] };

  const result = mergeGlueToolRegistrations({ coreToolIds: ["core_tool_x"], glueModules: [module], hostPort });

  assert.deepEqual(result.registeredModuleIds, ["m1"]);
  assert.deepEqual(result.quarantined, []);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.moduleId, "m1");
  assert.deepEqual(calls[0]!.registrations.map((r) => r.toolId), ["glue_tool_a"]);
});

test("CIC-3: a throwing module's build() is dropped and quarantined; a well-behaved sibling module still registers, and this function itself never throws", () => {
  const { hostPort, calls } = fakeHostPort();
  const broken: GlueToolModuleContribution = {
    moduleId: "broken",
    build: () => {
      throw new Error("kaboom");
    },
  };
  const good: GlueToolModuleContribution = { moduleId: "good", build: () => [registration("glue_tool_good")] };

  let result: ReturnType<typeof mergeGlueToolRegistrations>;
  assert.doesNotThrow(() => {
    result = mergeGlueToolRegistrations({ coreToolIds: [], glueModules: [broken, good], hostPort });
  });

  assert.deepEqual(result!.registeredModuleIds, ["good"]);
  assert.equal(result!.quarantined.length, 1);
  assert.equal(result!.quarantined[0]!.moduleId, "broken");
  assert.equal(result!.quarantined[0]!.reason, "THROW");
  assert.match(result!.quarantined[0]!.detail, /kaboom/);
  // The host port must never be asked to mount the broken module's (nonexistent) registrations.
  assert.deepEqual(
    calls.map((c) => c.moduleId),
    ["good"]
  );
});

test("CIC-3: a glue module whose tool id collides with a CORE tool id is quarantined, never silently registered over core", () => {
  const { hostPort, calls } = fakeHostPort();
  const colliding: GlueToolModuleContribution = { moduleId: "colliding", build: () => [registration("core_tool_x")] };

  const result = mergeGlueToolRegistrations({ coreToolIds: ["core_tool_x"], glueModules: [colliding], hostPort });

  assert.deepEqual(result.registeredModuleIds, []);
  assert.equal(result.quarantined.length, 1);
  assert.equal(result.quarantined[0]!.reason, "DUPLICATE_TOOL_ID");
  assert.equal(calls.length, 0, "the host port must never be called for a module quarantined pre-registration");
});

test("CIC-3: a SECOND glue module colliding with a FIRST glue module's already-merged tool id is quarantined; the first module's registration is unaffected", () => {
  const { hostPort, calls } = fakeHostPort();
  const first: GlueToolModuleContribution = { moduleId: "first", build: () => [registration("shared_tool_id")] };
  const second: GlueToolModuleContribution = { moduleId: "second", build: () => [registration("shared_tool_id")] };

  const result = mergeGlueToolRegistrations({ coreToolIds: [], glueModules: [first, second], hostPort });

  assert.deepEqual(result.registeredModuleIds, ["first"]);
  assert.equal(result.quarantined.length, 1);
  assert.equal(result.quarantined[0]!.moduleId, "second");
  assert.equal(result.quarantined[0]!.reason, "DUPLICATE_TOOL_ID");
  assert.deepEqual(
    calls.map((c) => c.moduleId),
    ["first"]
  );
});

test("CIC-3: a host port that itself throws when mounting a module's registrations is quarantined too, not propagated", () => {
  const hostPort = {
    registerTools: () => {
      throw new Error("mount failed");
    },
  };
  const module: GlueToolModuleContribution = { moduleId: "m", build: () => [registration("glue_tool_a")] };

  let result: ReturnType<typeof mergeGlueToolRegistrations>;
  assert.doesNotThrow(() => {
    result = mergeGlueToolRegistrations({ coreToolIds: [], glueModules: [module], hostPort });
  });

  assert.deepEqual(result!.registeredModuleIds, []);
  assert.equal(result!.quarantined[0]!.reason, "THROW");
  assert.match(result!.quarantined[0]!.detail, /mount failed/);
});

test("zero glue modules is a no-op: empty result, host port never called", () => {
  const { hostPort, calls } = fakeHostPort();
  const result = mergeGlueToolRegistrations({ coreToolIds: ["core_tool_x"], glueModules: [], hostPort });
  assert.deepEqual(result, { registeredModuleIds: [], quarantined: [] });
  assert.equal(calls.length, 0);
});

test("a module contributing MULTIPLE tool registrations succeeds or fails as a unit — a collision on the second id still quarantines the whole module, not a partial merge of the first", () => {
  const { hostPort, calls } = fakeHostPort();
  const module: GlueToolModuleContribution = {
    moduleId: "multi",
    build: () => [registration("glue_tool_ok"), registration("core_tool_x")],
  };

  const result = mergeGlueToolRegistrations({ coreToolIds: ["core_tool_x"], glueModules: [module], hostPort });

  assert.deepEqual(result.registeredModuleIds, []);
  assert.equal(result.quarantined[0]!.reason, "DUPLICATE_TOOL_ID");
  assert.equal(calls.length, 0, "no partial mount — the host port is never called for a quarantined module");
});
