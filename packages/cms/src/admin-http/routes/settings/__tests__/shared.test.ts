import { describe, expect, it } from "vitest";
import { ForbiddenError } from "@jini-ai/core/settings";

import { rejectSettingsError, runSettingsRoute, settingsRouteInput } from "../shared.js";
import { touchesProtectedNamespaces } from "../protected-namespaces.js";
import { FENCE, PRINCIPAL, baseDeps, recordingAuthorize, refusalOf, raw } from "./helpers.js";

const run = async () => "ran";

describe("settings shared guards", () => {
  it("parse passes query and body through without validating anything", () => {
    expect(settingsRouteInput(raw({ a: "1" }, { b: 2 }))).toEqual({ ok: true, value: { query: { a: "1" }, body: { b: 2 } } });
  });

  it("maps the first matching rung to { error: <message>, code } and rethrows anything unmapped", async () => {
    const mappings = [{ matches: (e: unknown) => e instanceof ForbiddenError, status: 403, code: "FORBIDDEN" }];
    expect(await refusalOf(() => rejectSettingsError({ err: new ForbiddenError("nope"), mappings }))).toEqual({ status: 403, body: { error: "nope", code: "FORBIDDEN" } });
    const unmapped = new Error("private backend");
    expect(() => rejectSettingsError({ err: unmapped, mappings })).toThrow(unmapped);
  });

  it("awaits readiness before anything else and a rejected readiness is rethrown (the host 500)", async () => {
    const order: string[] = [];
    const deps = { ...baseDeps(), settingsReady: Promise.reject(new Error("ledger down")) };
    await expect(runSettingsRoute({ deps, context: PRINCIPAL, authorize: recordingAuthorize().authorize, run: async () => { order.push("run"); } })).rejects.toThrow("ledger down");
    expect(order).toEqual([]);
  });

  it("fails closed without a principal (before the fence) or without an authorizer", async () => {
    const body = { namespace: "test.owner-only", key: "k" };
    await expect(runSettingsRoute({ deps: baseDeps(), context: undefined, authorize: recordingAuthorize().authorize, run }, { write: { body } })).rejects.toThrow(/no authenticated principal/);
    await expect(runSettingsRoute({ deps: baseDeps(), context: PRINCIPAL, authorize: undefined, run })).rejects.toThrow(/no authorizer/);
  });

  it("the write fence answers the injected 403 copy for a protected namespace, rename or batch item", async () => {
    for (const body of [{ namespace: "test.owner-only", key: "k" }, { namespace: "x", key: "k", newNamespace: "test.owner-only" }, { definitions: [{ namespace: "test.owner-only", key: "k" }] }]) {
      expect(await refusalOf(() => runSettingsRoute({ deps: baseDeps(), context: PRINCIPAL, authorize: recordingAuthorize().authorize, run }, { write: { body } })))
        .toEqual({ status: 403, body: { error: FENCE.protected.error, code: "FORBIDDEN" } });
    }
  });

  it("the code-owned fence applies to definition batches only, with the injected 400 code and copy", async () => {
    const batch = { definitions: [{ namespace: "test.code-owned", key: "k" }] };
    expect(await refusalOf(() => runSettingsRoute({ deps: baseDeps(), context: PRINCIPAL, authorize: recordingAuthorize().authorize, run }, { write: { body: batch } })))
      .toEqual({ status: 400, body: { error: FENCE.codeOwned.error, code: "TEST_CODE_OWNED" } });
    expect(await runSettingsRoute({ deps: baseDeps(), context: PRINCIPAL, authorize: recordingAuthorize().authorize, run }, { write: { body: { namespace: "test.code-owned", key: "k" } } })).toBe("ran");
  });

  it("reads never run the fence", async () => {
    expect(await runSettingsRoute({ deps: baseDeps(), context: PRINCIPAL, authorize: recordingAuthorize().authorize, run })).toBe("ran");
  });

  it("touchesProtectedNamespaces: non-object bodies, key-less batch items and unrelated keys touch nothing", async () => {
    const { settingsRepo: repo } = baseDeps();
    for (const body of [null, "x", { definitions: [{ namespace: "other" }] }, { namespace: "other", key: "k" }, { namespace: 5 }]) {
      expect(await touchesProtectedNamespaces({ body, repo, workspaceId: "ws-1", namespaces: ["test.owner-only"] })).toBe(false);
    }
    expect(await touchesProtectedNamespaces({ body: { namespace: "other" }, repo, workspaceId: "ws-1", namespaces: ["test.owner-only"] })).toBe(false);
  });
});
