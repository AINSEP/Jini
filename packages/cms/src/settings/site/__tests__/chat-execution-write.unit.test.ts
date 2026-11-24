import assert from "node:assert/strict";
import { test } from "vitest";

import type { DetectedAgent } from "@jini-ai/core/contracts/site/agent-runtime";
import { InMemorySettingsRepo, type SettingDefinitionRecord } from "@jini-ai/core/settings";

import { CHAT_EXECUTION_KEYS, prepareChatExecutionWrite } from "../chat-execution-write.js";
import type { ValidateRuntimeSelectionPort } from "../tool-deps.js";

/**
 * @file The chat selection check is the host-injected `validateRuntimeSelection`: the spy passed in
 * is the one called, once, with the live inventory and the resulting selection, and its refusal
 * text is what the tool reports.
 */

const agent = { id: "fixture", defaultModelResolution: { status: "resolved", id: "model-a" } } as unknown as DetectedAgent;

function fixture(refusal: string | null) {
  const definitions = CHAT_EXECUTION_KEYS.map((key, index) => ({
    settingId: key, version: 1, workspaceId: null, namespace: "core.execution", key, ownerKind: "core", ownerId: null,
    schema: { type: "string" }, defaultValue: ["fixture", "", ""][index], scopes: 6, secret: false,
    status: "active", aliasOfNamespace: null, aliasOfKey: null, coercionTag: null, createdAt: "now", updatedAt: "now",
  })) as SettingDefinitionRecord[];
  const calls: Array<Parameters<ValidateRuntimeSelectionPort>[0]> = [];
  const validateRuntimeSelection: ValidateRuntimeSelectionPort = (required) => { calls.push(required); return refusal; };
  const deps = {
    settingsRepo: new InMemorySettingsRepo({ definitions }), workspaceId: "workspace",
    authorize: async () => ({ allowed: true, reason: "fixture" }),
    assistantAgentInventory: { listAssistantAgents: async () => [], listDetectedAssistantAgents: async () => [agent] },
  };
  const request = { namespace: "core.execution", key: "localCli.model", scope: "user", value: "model-a", ctx: { principal: { id: "person" } }, toolId: "settings_set_value" };
  return { deps, request, calls, validateRuntimeSelection };
}

test("the injected selection check receives the live inventory and the resulting selection", async () => {
  const f = fixture(null);
  const bound = await prepareChatExecutionWrite(f);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0], { agents: [agent], agentId: "fixture", modelId: "model-a", effort: "" });
  assert.equal(bound, JSON.stringify({ previous: ["fixture", "", ""], selection: { agentId: "fixture", modelId: "model-a", effort: "" }, resolvedDefaultModel: null }));
});

test("the injected check's refusal is the tool's error", async () => {
  const f = fixture("Unknown model for this agent.");
  await assert.rejects(prepareChatExecutionWrite(f), /Unknown model for this agent\./);
});
