import assert from "node:assert/strict";
import { test } from "vitest";
import { createToolRegistry, ToolInputError, type ToolRegistration } from "@jini-ai/core";
import { createLiveSkillRegistration, createSkillRefreshMiddleware } from "../live-registration.js";

test("the host registry adapter forwards execution options and hides disabled slots", async () => {
  const registry = createToolRegistry({});
  let slot: ToolRegistration | undefined;
  const register = registry.register.bind(registry);
  registry.register = tool => { slot = tool; register(tool); };
  const replace = createLiveSkillRegistration(registry);
  const descriptor: ToolRegistration["descriptor"] = { id: "skill_fixture", description: "fixture", inputSchema: { type: "object", properties: {} } };
  let options: Parameters<ToolRegistration["handler"]>[1];
  const tool: ToolRegistration = { descriptor, policy: { authorize: () => "allow" }, handler: async (_required, optional) => { options = optional; return "current"; } };
  replace([tool]);
  const execution = { executionId: "fixture", principal: { id: "owner" }, run: { id: "run" }, input: {}, signal: new AbortController().signal };
  const optional = {};
  assert.equal(await slot!.handler(execution, optional), "current");
  assert.equal(options, optional);
  assert.throws(() => replace([tool, tool]), { message: "Duplicate skill registration ID." });
  replace([]);
  assert.deepEqual(registry.list({}), []);
  assert.equal(registry.has({ toolId: "skill_fixture" }), false);
  assert.throws(() => slot!.handler(execution), ToolInputError);
});

test("the host registry adapter forwards authorization to the live skill's own policy", () => {
  const registry = createToolRegistry({});
  let registered: ToolRegistration | undefined;
  const register = registry.register.bind(registry);
  registry.register = tool => { registered = tool; register(tool); };
  const replace = createLiveSkillRegistration(registry);
  const descriptor: ToolRegistration["descriptor"] = { id: "skill_policy", description: "fixture", inputSchema: { type: "object", properties: {} } };
  const seen: unknown[] = [];
  const tool: ToolRegistration = { descriptor, policy: { authorize: context => { seen.push(context); return "deny"; } }, handler: async () => "unused" };
  replace([tool]);
  assert.equal(registered?.descriptor.id, "skill_policy");
  assert.equal(registry.has({ toolId: "skill_policy" }), true);
  const authorization = { principal: { id: "owner" }, run: { id: "run" }, input: {} } as unknown as Parameters<ToolRegistration["policy"]["authorize"]>[0];
  assert.equal(registered!.policy.authorize(authorization), "deny");
  assert.deepEqual(seen, [authorization]);
});

test("the refresh middleware treats a registry without a skill refresher as unchanged and still continues the request", async () => {
  const registry = createToolRegistry({});
  let changed = 0;
  const middleware = createSkillRefreshMiddleware({ registry, onChanged: () => { changed += 1; } });
  const nextCalls: unknown[][] = [];
  await middleware(undefined, undefined, (...args) => { nextCalls.push(args); });
  assert.equal(changed, 0);
  assert.equal(nextCalls.length, 1);
  assert.equal(nextCalls[0]![0], undefined);
});

test("the refresh middleware reports a changed skill set and forwards a refresh failure to next", async () => {
  let changed = 0;
  const ok = createSkillRefreshMiddleware({ registry: Object.assign(createToolRegistry({}), { refreshInstalledSkills: async () => true }), onChanged: () => { changed += 1; } });
  let okError: unknown = "not called";
  await ok(undefined, undefined, error => { okError = error; });
  assert.equal(changed, 1);
  assert.equal(okError, undefined);
  const failure = new Error("skills dir unreadable");
  const failing = createSkillRefreshMiddleware({ registry: Object.assign(createToolRegistry({}), { refreshInstalledSkills: async () => { throw failure; } }), onChanged: () => { changed += 1; } });
  let failError: unknown;
  await failing(undefined, undefined, error => { failError = error; });
  assert.equal(failError, failure);
  assert.equal(changed, 1);
});

test("ids that were never a skill slot still answer from the host registry's own has", () => {
  const registry = createToolRegistry({});
  createLiveSkillRegistration(registry);
  const descriptor: ToolRegistration["descriptor"] = { id: "core_tool", description: "fixture", inputSchema: { type: "object", properties: {} } };
  registry.register({ descriptor, policy: { authorize: () => "allow" }, handler: async () => "core" });
  assert.equal(registry.has({ toolId: "core_tool" }), true);
  assert.equal(registry.has({ toolId: "never_registered" }), false);
  assert.deepEqual(registry.list({}).map(tool => tool.id), ["core_tool"]);
});
