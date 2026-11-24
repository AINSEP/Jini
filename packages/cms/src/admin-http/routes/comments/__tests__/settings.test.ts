import { describe, expect, it } from "vitest";
import { CommentsSettingsValidationError } from "../../../../comments/errors.js";
import type { CommentsSettings } from "../../../../comments/types.js";
import { commentsGetSettingsRoute } from "../get-settings.js";
import { commentsPutSettingsRoute } from "../put-settings.js";
import { PRINCIPAL, raw, recordingAuthorize, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

const SETTINGS = { enabled: true } as unknown as CommentsSettings;
const CONFIGURE = { permission: "comments.configure", entityType: "comments-settings" };

describe("commentsGetSettingsRoute", () => {
  it("waits for the settings definitions, authorizes comments.configure and answers { data }", async () => {
    expect([commentsGetSettingsRoute.method, commentsGetSettingsRoute.path]).toEqual(["get", "/api/admin/v1/workspaces/:workspaceId/comments/settings"]);
    expect(commentsGetSettingsRoute.parse(raw({}))).toEqual({ ok: true, value: {} });
    const order: string[] = [];
    let release!: () => void;
    const commentsSettingsReady = new Promise<void>((resolve) => { release = () => { order.push("ready"); resolve(); }; });
    const reads: unknown[] = [];
    const authorize = async () => { order.push("authorize"); };
    const pending = commentsGetSettingsRoute.handle({ input: {}, deps: { workspaceId: WORKSPACE_ID, commentsSettingsReady, getCommentsSettings: async (input) => { reads.push(input); return SETTINGS; } }, context: PRINCIPAL, authorize }, { signal });
    release();
    expect(await pending).toEqual({ ok: true, value: { data: SETTINGS } });
    expect(order).toEqual(["ready", "authorize"]);
    expect(reads).toEqual([{ workspaceId: WORKSPACE_ID }]);
  });

  it("stops on a denial before reading", async () => {
    const { authorize, calls } = recordingAuthorize({ deny: "comments.configure" });
    await expect(commentsGetSettingsRoute.handle({ input: {}, deps: { workspaceId: WORKSPACE_ID, commentsSettingsReady: Promise.resolve(), getCommentsSettings: async () => { throw new Error("read before auth"); } }, context: PRINCIPAL, authorize }, { signal })).rejects.toThrow("denied");
    expect(calls).toEqual([CONFIGURE]);
  });
});

describe("commentsPutSettingsRoute", () => {
  const deps = (setCommentsSettings: (input: { workspaceId: string; patch: Partial<CommentsSettings>; callerPrincipalId: string }) => Promise<CommentsSettings>) =>
    ({ workspaceId: WORKSPACE_ID, commentsSettingsReady: Promise.resolve(), setCommentsSettings, outwardErrorMessage: ({ error }: { error: Error }) => error.message });

  it("defaults a missing body to an empty patch", () => {
    expect([commentsPutSettingsRoute.method, commentsPutSettingsRoute.path]).toEqual(["put", "/api/admin/v1/workspaces/:workspaceId/comments/settings"]);
    expect(commentsPutSettingsRoute.parse(raw({}))).toEqual({ ok: true, value: { patch: {} } });
    expect(commentsPutSettingsRoute.parse(raw({ body: { maxDepth: 2 } }))).toEqual({ ok: true, value: { patch: { maxDepth: 2 } } });
  });

  it("authorizes, writes the patch as the caller and answers { data }", async () => {
    const writes: unknown[] = [];
    const { authorize, calls } = recordingAuthorize();
    const result = await commentsPutSettingsRoute.handle({ input: { patch: { maxDepth: 2 } }, deps: deps(async (input) => { writes.push(input); return SETTINGS; }), context: PRINCIPAL, authorize }, { signal });
    expect(result).toEqual({ ok: true, value: { data: SETTINGS } });
    expect(calls).toEqual([CONFIGURE]);
    expect(writes).toEqual([{ workspaceId: WORKSPACE_ID, patch: { maxDepth: 2 }, callerPrincipalId: PRINCIPAL.id }]);
  });

  it("maps a validation failure to a coded 400 and lets anything else through", async () => {
    const run = (err: Error) => commentsPutSettingsRoute.handle({ input: { patch: {} }, deps: deps(async () => { throw err; }), context: PRINCIPAL, authorize: recordingAuthorize().authorize }, { signal });
    expect(await refusalOf(() => run(new CommentsSettingsValidationError("maxDepth must be at most 10"))))
      .toEqual({ status: 400, body: { error: "maxDepth must be at most 10", code: "COMMENTS_SETTINGS_VALIDATION_ERROR" } });
    await expect(run(new Error("db down"))).rejects.toThrow("db down");
  });

  it("answers the validation 400 with the host's outward message", async () => {
    const hosted = { ...deps(async () => { throw new CommentsSettingsValidationError("maxDepth must be at most 10"); }), outwardErrorMessage: ({ error }: { error: Error }) => `host: ${error.message}` };
    expect(await refusalOf(() => commentsPutSettingsRoute.handle({ input: { patch: {} }, deps: hosted, context: PRINCIPAL, authorize: recordingAuthorize().authorize }, { signal })))
      .toEqual({ status: 400, body: { error: "host: maxDepth must be at most 10", code: "COMMENTS_SETTINGS_VALIDATION_ERROR" } });
  });
});
