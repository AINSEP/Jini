import { ToolInputError, type ToolExecutionContext, type ToolRegistration } from "@jini-ai/core";
import { describe, expect, it, vi } from "vitest";

import { InMemoryCommentRepo } from "../repo.memory.js";
import {
  buildCommentsToolRegistrations,
  commentsDerivedRisk,
  type CommentsApprovalHandler,
  type CommentsPackageToolDeps,
  type CommentsSettingsPort,
} from "../tool-registrations.js";
import type { CommentRecord, CommentsSettings } from "../types.js";
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

const comment: CommentRecord = {
  id: "comment-8", workspaceId: "ws-1", entryId: "entry-2", parentId: null, threadRootId: "comment-8",
  depth: 0, status: "pending", authorPrincipalId: null, authorName: "Visitor", authorEmail: "visitor@example.test",
  authorUrl: "https://private.example", authorIpHash: "private-hash", bodyText: "Please update the hours.",
  spamScore: 0.1, spamProvider: "internal", createdAt: "2026-11-26T14:00:00.000Z", updatedAt: "2026-11-26T14:05:00.000Z", version: 3,
};
const view = {
  id: "comment-8", entryId: "entry-2", parentId: null, status: "pending", authorName: "Visitor",
  authorEmail: "visitor@example.test", bodyText: "Please update the hours.", spamScore: 0.1,
  createdAt: "2026-11-26T14:00:00.000Z", version: 3,
};

it("looks up one scoped comment and projects the same safe moderation fields as the queue", async () => {
  const commentRepo = new InMemoryCommentRepo({ initialComments: [
    { ...comment, workspaceId: "other-workspace", bodyText: "foreign comment" },
    comment, { ...comment, id: "spam-4", status: "spam", bodyText: "Repeated ad." },
  ] });
  const { registrations, calls } = makeDeps({ commentRepo });
  expect(await run(registrations, "comments_get_comment", { commentId: "comment-8" })).toEqual({ comment: view });
  expect(await run(registrations, "comments_list_moderation_queue", {})).toEqual({ items: [view], nextCursor: null });
  expect(await run(registrations, "comments_list_moderation_queue", { status: "spam", limit: 1 })).toEqual({
    items: [{ ...view, id: "spam-4", status: "spam", bodyText: "Repeated ad." }], nextCursor: null,
  });
  await expect(run(registrations, "comments_get_comment", { commentId: "absent" })).rejects.toThrow("COMMENTS_NOT_FOUND: comment 'absent' was not found");
  expect(calls.authorize).toEqual(Array.from({ length: 4 }, () => "comments.read"));
});

it.each([
  [null, undefined, true, "Public comments are off. Stored comments, settings and the moderation queue are kept; select built-in to show them again."],
  ["built-in", undefined, true, "The 'built-in' provider is selected but not ready yet; comments are not showing. Try again shortly."],
  ["built-in", {}, false, "The 'built-in' provider is selected but comments are disabled in comments settings; enable them there."],
  ["built-in", {}, true, undefined],
] as const)("describes provider %s readiness without dropping the count of stored pending comments", async (providerId, adapter, enabled, note) => {
  const commentRepo = new InMemoryCommentRepo({ initialComments: [comment, { ...comment, workspaceId: "elsewhere" }] });
  const { registrations, calls } = makeDeps({
    commentRepo,
    commentsProviders: { active: async () => ({ providerId, revision: 6, adapter }), select: async () => {} },
    commentsSettings: { get: async () => ({ ...SETTINGS, enabled }), set: async () => { throw new Error("read-only fixture"); } },
  });
  expect(await run(registrations, "comments_get_provider", {})).toEqual({
    providerId, revision: 6, ready: note === undefined, pendingCount: 1, ...(note === undefined ? {} : { note }),
  });
  expect(calls.authorize).toEqual(["comments.configure"]);
});

it.each([
  ["comments_approve_comment", "approve", "approved", "comments.moderate"],
  ["comments_mark_comment_spam", "mark_spam", "spam", "comments.moderate"],
  ["comments_restore_comment", "restore", "approved", "comments.moderate"],
  ["comments_trash_comment", "trash", "trash", "comments.delete"],
] as const)("wires %s to the guarded action and updates repository state", async (tool, action, toStatus, permission) => {
  const commentRepo = new InMemoryCommentRepo({ initialComments: [{ ...comment, status: action === "restore" ? "trash" : "pending" }] });
  const applyModeration = vi.fn<CommentsPackageToolDeps["commentWriteService"]["applyModeration"]>(async (input) =>
    commentRepo.applyModeration({ ...input, at: "2026-11-26T15:00:00.000Z" }));
  const { registrations, calls } = makeDeps({ commentRepo, commentWriteService: { applyModeration, purge: async () => { throw new Error("unexpected purge"); } } });
  const acknowledgment = { moderated: { commentId: "comment-8", toStatus } };
  expect(await run(registrations, tool, { commentId: "comment-8", expectedVersion: 3, note: "reviewed" })).toEqual(
    action === "trash" ? { ...acknowledgment, trashed: true, cancelled: false } : acknowledgment,
  );
  expect(applyModeration.mock.calls).toEqual([[{
    workspaceId: "ws-1", id: "comment-8", expectedVersion: 3, actorPrincipalId: "p1", note: "reviewed", action, toStatus,
    ...(action === "trash" ? { actorPluginId: "assistant" } : {}),
  }]]);
  expect(calls.authorize).toEqual(action === "trash" ? [permission, permission] : [permission]);
  expect(await commentRepo.findById({ workspaceId: "ws-1", id: "comment-8" })).toMatchObject({ status: toStatus, version: 4 });
});

it("returns actionable version conflicts and missing-comment refusals without changing the row", async () => {
  const commentRepo = new InMemoryCommentRepo({ initialComments: [comment] });
  const applyModeration = vi.fn<CommentsPackageToolDeps["commentWriteService"]["applyModeration"]>(async (input) =>
    commentRepo.applyModeration({ ...input, at: "2026-11-26T15:00:00.000Z" }));
  const { registrations } = makeDeps({ commentRepo, commentWriteService: { applyModeration, purge: async () => { throw new Error("unexpected purge"); } } });
  await expect(run(registrations, "comments_trash_comment", { commentId: "absent", expectedVersion: 3 })).rejects.toThrow("COMMENTS_NOT_FOUND: comment 'absent' was not found");
  expect(applyModeration.mock.calls).toEqual([]);
  await expect(run(registrations, "comments_approve_comment", { commentId: "absent", expectedVersion: 3 })).rejects.toThrow("COMMENTS_NOT_FOUND: comment 'absent' was not found");
  await expect(run(registrations, "comments_trash_comment", { commentId: "comment-8", expectedVersion: 2, note: 7 })).rejects.toThrow(
    "COMMENTS_VERSION_CONFLICT: comment 'comment-8' was modified concurrently (current version is 3)",
  );
  expect(applyModeration.mock.calls.at(-1)).toEqual([{
    workspaceId: "ws-1", id: "comment-8", expectedVersion: 2, actorPrincipalId: "p1", actorPluginId: "assistant", note: null, action: "trash", toStatus: "trash",
  }]);
  expect(await commentRepo.findById({ workspaceId: "ws-1", id: "comment-8" })).toEqual(comment);
});
