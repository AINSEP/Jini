import { ToolInputError, type ToolExecutionContext, type ToolRegistration } from "@jini-ai/core";
import { describe, expect, it } from "vitest";

import { InMemoryCommentRepo } from "../repo.memory.js";
import {
  buildCommentsToolRegistrations,
  commentsDerivedRisk,
  type CommentsApprovalHandler,
  type CommentsPackageToolDeps,
  type CommentsSettingsPort,
} from "../tool-registrations.js";
import type { CommentsSettings } from "../types.js";
import { CommentsSettingsValidationError } from "../errors.js";

const SETTINGS: CommentsSettings = { enabled: true, requireModeration: true, maxDepth: 5, closeAfterDays: null, spamAutoRejectScore: 0.5, maxPerIpPerHour: 20 };

class SettingsRefusal extends Error {}

/** A fake approval wrapper that confirms at once: it runs prepare, describe, then run, like a person clicking confirm. */
const confirmingApproval: CommentsApprovalHandler = (steps, options) => async (ctx) => {
  const prepared = await steps.prepare({ ctx });
  steps.describe({ ctx, prepared });
  const result = await steps.run({ ctx, prepared });
  return { ...(result as object), flag: options.flag };
};

function makeDeps(overrides: Partial<CommentsPackageToolDeps> = {}) {
  const calls = { settingsSet: [] as unknown[], selections: [] as unknown[], authorize: [] as string[] };
  const settings: CommentsSettingsPort = {
    get: async () => SETTINGS,
    set: async (input) => { calls.settingsSet.push(input); return { ...SETTINGS, ...input.patch }; },
  };
  const deps: CommentsPackageToolDeps = {
    authorize: async (params) => { calls.authorize.push(String((params as { permission?: unknown }).permission)); return { allowed: true, reason: "matched" }; },
    workspaceId: "ws-1",
    commentsReady: Promise.resolve(),
    commentsSettingsReady: Promise.resolve(),
    commentRepo: new InMemoryCommentRepo(),
    commentWriteService: {} as CommentsPackageToolDeps["commentWriteService"],
    commentsSettings: settings,
    settingsForbiddenError: SettingsRefusal,
    approvalHandler: confirmingApproval,
    refuseUnexpectedKeys: (input, allowed) => {
      const extra = Object.keys(input).find((key) => !allowed.includes(key));
      if (extra !== undefined) throw new ToolInputError({ message: `unexpected ${extra}` });
    },
    commentsProviders: {
      active: async () => ({ providerId: "built-in", revision: 0, adapter: {} }),
      select: async (required) => { calls.selections.push(required); },
    },
    ...overrides,
  };
  const registrations = buildCommentsToolRegistrations({ deps, surfaces: {} as never });
  return { calls, registrations };
}

function run(registrations: ToolRegistration[], id: string, input: unknown): Promise<unknown> {
  const tool = registrations.find((registration) => registration.descriptor.id === id);
  if (!tool) throw new Error(`${id} is not wired`);
  const ctx: ToolExecutionContext = { executionId: "e1", principal: { id: "p1" }, run: { id: "r1" }, input, signal: new AbortController().signal };
  return Promise.resolve(tool.handler(ctx, {}));
}

describe("buildCommentsToolRegistrations", () => {
  it("registers the ten comments tools in catalog order, with no host metadata", () => {
    const { registrations } = makeDeps();
    expect(registrations.map((registration) => registration.descriptor.id)).toEqual([
      "comments_get_provider", "comments_set_provider", "comments_get_comment", "comments_list_moderation_queue", "comments_get_settings",
      "comments_update_settings", "comments_approve_comment", "comments_mark_comment_spam", "comments_trash_comment", "comments_restore_comment",
    ]);
    expect(registrations.every((registration) => registration.descriptor.metadata === undefined)).toBe(true);
    expect([...commentsDerivedRisk.keys()]).toHaveLength(10);
  });

  it("reads the settings through the port after the configure permission check", async () => {
    const { registrations, calls } = makeDeps();
    expect(await run(registrations, "comments_get_settings", {})).toEqual({ settings: SETTINGS });
    expect(calls.authorize).toEqual(["comments.configure"]);
  });

  it("writes a settings patch through the port and refuses an empty patch as an input error", async () => {
    const { registrations, calls } = makeDeps();
    await run(registrations, "comments_update_settings", { maxDepth: 2 });
    expect(calls.settingsSet).toEqual([{ workspaceId: "ws-1", patch: { maxDepth: 2 }, callerPrincipalId: "p1" }]);
    await expect(run(registrations, "comments_update_settings", {})).rejects.toBeInstanceOf(ToolInputError);
  });

  it("maps the settings validation error to an input error and the settings refusal class to the forbidden code", async () => {
    const invalid = makeDeps({ commentsSettings: { get: async () => SETTINGS, set: async () => { throw new CommentsSettingsValidationError("maxDepth must be at most 20"); } } });
    await expect(run(invalid.registrations, "comments_update_settings", { maxDepth: 99 })).rejects.toMatchObject({ message: "maxDepth must be at most 20" });
    const refused = makeDeps({ commentsSettings: { get: async () => SETTINGS, set: async () => { throw new SettingsRefusal("no"); } } });
    await expect(run(refused.registrations, "comments_update_settings", { enabled: false })).rejects.toMatchObject({ message: "COMMENTS_FORBIDDEN: no" });
  });

  it("changes the provider only through the injected approval wrapper, after the unexpected-key refusal", async () => {
    const { registrations, calls } = makeDeps({ commentRepo: Object.assign(new InMemoryCommentRepo(), { countByStatus: async () => 0 }) });
    await expect(run(registrations, "comments_set_provider", { providerId: null, expectedRevision: 0, confirm: true })).rejects.toThrow("unexpected confirm");
    expect(calls.selections).toEqual([]);
    expect(await run(registrations, "comments_set_provider", { providerId: null, expectedRevision: 0 })).toMatchObject({ changed: true, providerId: null, flag: "changed" });
    expect(calls.selections).toEqual([{ siteId: "ws-1", providerId: null, expectedRevision: 0, actorPrincipalId: "p1" }]);
  });

  it("says the provider service is unavailable when the host passes none", async () => {
    const { registrations } = makeDeps({ commentsProviders: undefined });
    await expect(run(registrations, "comments_get_provider", {})).rejects.toMatchObject({ message: "Comments provider service is unavailable." });
  });
});
