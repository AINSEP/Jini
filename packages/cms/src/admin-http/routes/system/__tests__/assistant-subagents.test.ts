import { describe, expect, it } from "vitest";

import { ASSISTANT_SUBAGENTS_PATH, assistantSubagentsGrant, type AssistantCliGrant, type AssistantSubagentsRouteDeps } from "../assistant-subagents.js";
import { refusalOf } from "../../settings/__tests__/helpers.js";

const off: AssistantCliGrant = { enabled: false, capabilities: { files: false, shell: false } };

/** Deps that record every host call; `per` resolves an agent's effective grant from a settings value. */
function fixture({ layerSeq = 5, next = off }: { layerSeq?: number; next?: AssistantCliGrant } = {}) {
  const calls: Array<[string, unknown]> = [];
  const deps: AssistantSubagentsRouteDeps = {
    grant: { namespace: "test.cli", key: "permissions", writeReason: "TEST owner only", uneditableError: "TEST hosted" },
    capabilityKeys: ["files", "shell"], agentIds: ["alpha", "beta"],
    readPermissions: async () => { calls.push(["read", null]); return next; },
    normalize: (input) => ({ enabled: input.enabled, capabilities: { files: input.enabled, shell: input.enabled, ...input.capabilities } }),
    projectRead: ({ settings, isOwner }) => ({ ...settings, projected: isOwner }),
    canEdit: ({ isOwner }) => isOwner,
    readLayer: async () => { calls.push(["layer", null]); return { raw: { stored: true }, revisionSeq: layerSeq }; },
    patchLayer: (input) => { calls.push(["patch", input]); return { patched: true }; },
    resolveAgentPermissions: ({ settings, agentId }) => agentId === "beta" ? { enabled: settings.enabled, capabilities: settings.capabilities } : { enabled: true, capabilities: { files: true, shell: true } },
    lowerToolAccess: async (input) => { calls.push(["lower", input]); },
  };
  return { deps, calls, policy: assistantSubagentsGrant(deps) };
}

describe("assistant subagents (full CLI) grant", () => {
  it("pins the path and a user-scoped grant without acknowledgment, bound to the injected copy and host policy", () => {
    const { policy } = fixture();
    expect(ASSISTANT_SUBAGENTS_PATH).toBe("/api/admin/v1/workspaces/:workspaceId/system/assistant-full-cli");
    expect([policy.namespace, policy.key, policy.writeReason, policy.uneditableError, policy.requireAcknowledgment, policy.scope, policy.validationError])
      .toEqual(["test.cli", "permissions", "TEST owner only", "TEST hosted", false, "user", "enabled and capability values must be booleans."]);
    expect(policy.canEdit?.({ isOwner: false })).toBe(false);
    expect(policy.projectRead?.({ settings: off, isOwner: true })).toEqual({ ...off, projected: true });
  });

  it("parse refuses unknown or non-boolean capabilities and malformed overrides; normalizes the rest", async () => {
    const { policy } = fixture();
    const refusal = { status: 400, body: { error: "Unknown capability or non-boolean value.", code: "VALIDATION_ERROR" } };
    for (const capabilities of [null, [], "x", { nope: true }, { files: "yes" }]) {
      expect(await refusalOf(() => policy.parse({ body: { enabled: true, capabilities } }))).toEqual(refusal);
    }
    expect(policy.parse({ body: { enabled: true, capabilities: { shell: false } } })).toEqual({ enabled: true, capabilities: { files: true, shell: false } });
    expect(policy.parse({ body: { enabled: false } })).toEqual(off);
    expect(policy.value({ settings: { enabled: true, capabilities: { files: true, shell: false } } })).toEqual({ enabled: true, capabilities: { files: true, shell: false } });
  });

  it("prepareWrite: a bad agent id is 400, a stale revision is 409, else the patched layer at its revision", async () => {
    const settings = { enabled: true, capabilities: { files: true, shell: true } };
    for (const agentId of [7, "Bad", "-x", "a".repeat(65)]) {
      const { policy, calls } = fixture();
      expect(await refusalOf(() => policy.prepareWrite!({ body: { agentId }, settings, previous: off }))).toEqual({ status: 400, body: { error: "Choose a valid agent.", code: "VALIDATION_ERROR" } });
      expect(calls).toEqual([]);
    }
    const stale = fixture();
    expect(await refusalOf(() => stale.policy.prepareWrite!({ body: { expectedRevisionSeq: 4 }, settings, previous: off })))
      .toEqual({ status: 409, body: { error: "Agent permissions changed. Read them again before saving.", code: "REVISION_CONFLICT" } });
    const master = fixture();
    expect(await master.policy.prepareWrite!({ body: { expectedRevisionSeq: 5 }, settings, previous: off })).toEqual({ value: { patched: true }, revisionSeq: 5 });
    expect(master.calls[1]).toEqual(["patch", { raw: { stored: true }, defaults: settings }]);
    const item = fixture();
    await item.policy.prepareWrite!({ body: { agentId: "beta", capabilities: { shell: false } }, settings, previous: off });
    expect(item.calls[1]).toEqual(["patch", { raw: { stored: true }, defaults: off, agentId: "beta", capabilities: { shell: false } }]);
  });

  it("afterWrite re-reads and lowers tool access only for agents that lost a grant", async () => {
    const before = { enabled: true, capabilities: { files: true, shell: true } };
    const narrowed = fixture({ next: { enabled: true, capabilities: { files: true, shell: false } } });
    expect(await narrowed.policy.afterWrite!({ settings: before, previous: before, body: {} })).toEqual({ enabled: true, capabilities: { files: true, shell: false } });
    expect(narrowed.calls).toEqual([["read", null], ["lower", { agentIds: ["beta"] }]]);
    const widened = fixture({ next: before });
    await widened.policy.afterWrite!({ settings: before, previous: off, body: {} });
    expect(widened.calls).toEqual([["read", null]]);
  });
});

it("reads the current permission grant from the bound host", async () => {
  const next = { enabled: true, capabilities: { files: false, shell: true } };
  const { policy, calls } = fixture({ next });
  expect(await policy.read()).toEqual(next);
  expect(calls).toEqual([["read", null]]);
});
