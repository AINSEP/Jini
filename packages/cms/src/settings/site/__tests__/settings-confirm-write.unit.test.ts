import assert from "node:assert/strict";
import { test } from "vitest";

import type { ToolExecutionContext } from "@jini-ai/core";
import type { DetectedAgent } from "@jini-ai/core/contracts/site/agent-runtime";
import type { AssistantSurfaceDeps } from "@jini-ai/core/contracts/site/daemon-surface-exchanges";
import { InMemorySettingsRepo, type SettingDefinitionRecord, type SettingsWriteConfirmation } from "@jini-ai/core/settings";

import { CHAT_EXECUTION_KEYS } from "../chat-execution-write.js";
import { settingsConfirmWrite, type SettingsConfirmApprovalHandlerPort, type SettingsConfirmCard, type SettingsConfirmWriteCopy } from "../settings-confirm-write.js";
import type { SettingsToolDeps, ValidateRuntimeSelectionPort } from "../tool-deps.js";

/**
 * @file `settingsConfirmWrite` builds the card from the host's injected copy and hands it to the
 * host's injected approval engine; the chat-selection check is the injected validator, called with
 * the same selection before the card and again after it.
 */

const copy: SettingsConfirmWriteCopy = {
  errorCode: "FIXTURE_CODE", setTitle: "Set it?", clearTitle: "Clear it?", descriptionSuffix: " (fixture suffix)",
  clearProposed: "fixture fallback", confirmLabel: "Fixture confirm",
  labels: { plugin: "P", pluginVersion: "PV", setting: "S", scope: "SC", resultingSelection: "RS" },
};
const agent = { id: "fixture", defaultModelResolution: { status: "resolved", id: "model-a" } } as unknown as DetectedAgent;
const surfaces = { marker: "surfaces" } as unknown as AssistantSurfaceDeps;

function fixture({ identityKeys = ["plugin@1"], aborted = false, confirm = true }: { identityKeys?: string[]; aborted?: boolean; confirm?: boolean } = {}) {
  const definitions = CHAT_EXECUTION_KEYS.map((key, index) => ({
    settingId: key, version: 1, workspaceId: null, namespace: "core.execution", key, ownerKind: "core", ownerId: null,
    schema: { type: "string" }, defaultValue: ["fixture", "", ""][index], scopes: 6, secret: false,
    status: "active", aliasOfNamespace: null, aliasOfKey: null, coercionTag: null, createdAt: "now", updatedAt: "now",
  })) as SettingDefinitionRecord[];
  const validations: Array<Parameters<ValidateRuntimeSelectionPort>[0]> = [];
  const validateRuntimeSelection: ValidateRuntimeSelectionPort = (required) => { validations.push(required); return null; };
  let identityCall = 0;
  const routeDeps = {
    settingsRepo: new InMemorySettingsRepo({ definitions }), workspaceId: "workspace",
    authorize: async () => ({ allowed: true, reason: "fixture" }),
    assistantAgentInventory: { listAssistantAgents: async () => [], listDetectedAssistantAgents: async () => [agent] },
    ...(identityKeys.length ? { approvalIdentityForRun: async () => {
      const key = identityKeys[Math.min(identityCall++, identityKeys.length - 1)]!;
      return { key, label: "Fixture plugin", version: "1.0" };
    } } : {}),
  } as unknown as SettingsToolDeps;
  const seen: { surfaces?: AssistantSurfaceDeps; card?: SettingsConfirmCard; declined?: unknown } = {};
  // A minimal stand-in for the host engine: prepare, describe, ask (confirm/decline), run.
  const approvalToolHandler: SettingsConfirmApprovalHandlerPort = (required, optional) => {
    seen.surfaces = required.surfaces;
    return async (ctx) => {
      const prepared = await required.prepare({ ctx });
      seen.card = required.describe({ ctx, prepared });
      if (!confirm) return (seen.declined = optional.declined());
      return required.run({ ctx, prepared });
    };
  };
  const ctx = { principal: { id: "person" }, signal: { aborted } } as unknown as ToolExecutionContext;
  const confirmWrite = settingsConfirmWrite({ surfaces, routeDeps, approvalToolHandler, validateRuntimeSelection, copy });
  return { confirmWrite, ctx, seen, validations };
}

const request = (ctx: ToolExecutionContext, overrides: Partial<SettingsWriteConfirmation> = {}): SettingsWriteConfirmation => ({
  ctx, toolId: "settings_set_value", namespace: "core.site", key: "title", scope: "workspace",
  previous: "Old", expectedRevisionSeq: 3, value: "New", reason: "Changes the title", ...overrides,
});
/** A clear carries no value at all (the package omits the field rather than sending undefined). */
const clearRequest = (ctx: ToolExecutionContext): SettingsWriteConfirmation => {
  const { value: _value, ...rest } = request(ctx, { toolId: "settings_clear_value" });
  return rest;
};

test("the card is built from the injected copy and handed to the injected approval engine", async () => {
  const f = fixture();
  assert.equal(await f.confirmWrite(request(f.ctx)), true);
  assert.equal(f.seen.surfaces, surfaces);
  assert.deepEqual(f.seen.card, {
    toolId: "settings_set_value", errorCode: "FIXTURE_CODE", title: "Set it?", description: "Changes the title (fixture suffix)",
    access: { resources: [{ id: "core.site.title:workspace", label: "core.site.title", scope: { personId: "person", siteId: "workspace" }, previous: "Old", proposed: "New", revision: "3" }] },
    details: [{ label: "P", value: "Fixture plugin" }, { label: "PV", value: "1.0" }, { label: "S", value: "core.site.title" }, { label: "SC", value: "workspace" }],
    confirmLabel: "Fixture confirm",
  });
  assert.equal(f.validations.length, 0);
});

test("a clear uses the injected clear title and fallback wording", async () => {
  const f = fixture();
  await f.confirmWrite(clearRequest(f.ctx));
  assert.equal(f.seen.card?.title, "Clear it?");
  assert.equal(f.seen.card?.access.resources[0]?.proposed, "fixture fallback");
});

test("a chat selection is checked by the injected validator with the same args before and after the card", async () => {
  const f = fixture();
  const ctx = f.ctx;
  assert.equal(await f.confirmWrite(request(ctx, { namespace: "core.execution", key: "localCli.model", scope: "user", value: "model-a" })), true);
  const selection = { agents: [agent], agentId: "fixture", modelId: "model-a", effort: "" };
  assert.deepEqual(f.validations, [selection, selection]);
  assert.deepEqual(f.seen.card?.details.at(-1), { label: "RS", value: { previous: ["fixture", "", ""], selection: { agentId: "fixture", modelId: "model-a", effort: "" }, resolvedDefaultModel: null } });
});

test("a declined, aborted or identity-drifted card is not a confirmation", async () => {
  const declined = fixture({ confirm: false });
  assert.equal(await declined.confirmWrite(request(declined.ctx)), false);
  assert.deepEqual(declined.seen.declined, { confirmed: false });
  const aborted = fixture({ aborted: true });
  assert.equal(await aborted.confirmWrite(request(aborted.ctx)), false);
  const drifted = fixture({ identityKeys: ["plugin@1", "plugin@2"] });
  assert.equal(await drifted.confirmWrite(request(drifted.ctx)), false);
});

test("an omitted proposal displays as null and can be confirmed without plugin details", async () => {
  const f = fixture({ identityKeys: [] });
  const { value: _value, ...proposal } = request(f.ctx);
  assert.equal(await f.confirmWrite(proposal), true);
  assert.equal(f.seen.card?.access.resources[0]?.proposed, null);
  assert.deepEqual(f.seen.card?.details, [{ label: "S", value: "core.site.title" }, { label: "SC", value: "workspace" }]);
});
