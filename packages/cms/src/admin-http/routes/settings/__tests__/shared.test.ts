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

it("preserves the public text even when a custom mapping handles a string refusal", async () => {
  const mappings = [{ matches: (e: unknown) => e === "write locked", status: 409, code: "TEST_LOCKED" }];
  expect(await refusalOf(() => rejectSettingsError({ err: "write locked", mappings })))
    .toEqual({ status: 409, body: { error: "write locked", code: "TEST_LOCKED" } });
});

it("fences a protected alias on a keyed write and namespace reset, but not an unrelated active key", async () => {
  const { settingsRepo: repo, workspaceId } = baseDeps();
  const record = {
    version: 1, workspaceId: null, namespace: "core.legacy", ownerKind: "core", ownerId: null,
    schema: { type: "string" }, defaultValue: "release", scopes: 2, secret: false, coercionTag: null,
    createdAt: "2026-11-26T00:00:00.000Z", updatedAt: "2026-11-26T00:00:00.000Z",
    status: "active", aliasOfNamespace: null, aliasOfKey: null,
  } as const;
  await repo.saveDefinition({ ...record, settingId: "regular", key: "regular" });
  await repo.saveDefinition({ ...record, settingId: "protected", namespace: "core.owner", key: "account" });
  await repo.saveDefinition({ ...record, settingId: "alias", key: "old-account", status: "alias", aliasOfNamespace: "core.owner", aliasOfKey: "account" });
  const touches = (body: unknown) => touchesProtectedNamespaces({ body, repo, workspaceId, namespaces: ["core.owner"] });

  expect(await touches({ namespace: "core.legacy", key: "regular" })).toBe(false);
  expect(await touches({ namespace: "core.legacy", key: "old-account" })).toBe(true);
  expect(await touches({ namespace: "core.legacy" })).toBe(true);
  expect(await touches({ definitions: [null, false, { namespace: "core.legacy" }] })).toBe(false);
  expect(await touches({ definitions: [null, { namespace: ["core.owner"] }] })).toBe(true);
});
