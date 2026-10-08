import assert from "node:assert/strict";
import { test } from "vitest";

import { createCapturingResponse } from "./settings-fixture.js";
import {
  resolveTargetWorkspaceId,
  resolveUserLayerReadTarget,
  respondToSettingsError,
} from "../index.js";

const deps = { workspaceId: "workspace-local" };

test("resolveTargetWorkspaceId: a global-scope write targets no workspace, even when the body names this one", () => {
  assert.deepEqual(resolveTargetWorkspaceId({ workspaceId: deps.workspaceId, input: { bodyWorkspaceId: undefined, scope: "global" } }), { ok: true, workspaceId: undefined });
  assert.deepEqual(resolveTargetWorkspaceId({ workspaceId: deps.workspaceId, input: { bodyWorkspaceId: "workspace-local", scope: "global" } }), { ok: true, workspaceId: undefined });
});

test("resolveTargetWorkspaceId: a non-global write always targets the route's own workspace", () => {
  assert.deepEqual(resolveTargetWorkspaceId({ workspaceId: deps.workspaceId, input: { bodyWorkspaceId: undefined, scope: "workspace" } }), { ok: true, workspaceId: "workspace-local" });
  assert.deepEqual(resolveTargetWorkspaceId({ workspaceId: deps.workspaceId, input: { bodyWorkspaceId: "workspace-local", scope: "user" } }), { ok: true, workspaceId: "workspace-local" });
});

test("resolveTargetWorkspaceId: null and empty-string body workspaceIds count as not named, not as a mismatch", () => {
  for (const blank of [null, ""]) {
    assert.deepEqual(resolveTargetWorkspaceId({ workspaceId: deps.workspaceId, input: { bodyWorkspaceId: blank, scope: "workspace" } }), { ok: true, workspaceId: "workspace-local" });
  }
});

test("resolveTargetWorkspaceId: any other named workspace is refused, for every scope including global", () => {
  for (const scope of ["global", "workspace", "user"] as const) {
    assert.deepEqual(resolveTargetWorkspaceId({ workspaceId: deps.workspaceId, input: { bodyWorkspaceId: "workspace-other", scope } }), {
      ok: false,
      error: "workspaceId 'workspace-other' does not match this route's workspace; a settings write cannot target another workspace",
    });
  }
});

test("resolveUserLayerReadTarget: reading your own layer (or none) never asks authorize", async () => {
  let calls = 0;
  const authorize = async () => {
    calls += 1;
    return { allowed: false as const, reason: "should not be asked" };
  };
  assert.deepEqual(await resolveUserLayerReadTarget({ deps: { ...deps, authorize, permission: "custom.user.read" }, input: { requestedPrincipalId: undefined, callerPrincipalId: "me" } }), {
    allowed: true,
    principalId: undefined,
  });
  assert.deepEqual(await resolveUserLayerReadTarget({ deps: { ...deps, authorize, permission: "custom.user.read" }, input: { requestedPrincipalId: "me", callerPrincipalId: "me" } }), {
    allowed: true,
    principalId: "me",
  });
  assert.equal(calls, 0);
});

test("resolveUserLayerReadTarget: another principal's layer requires settings.user.read and relays the denial reason", async () => {
  const seen: Array<Record<string, unknown>> = [];
  const authorizeWith = (allowed: boolean) => async (params: Record<string, unknown>) => {
    seen.push(params);
    return { allowed, reason: allowed ? "allowed" : "no_grant" };
  };
  assert.deepEqual(
    await resolveUserLayerReadTarget({ deps: { ...deps, authorize: authorizeWith(false), permission: "custom.user.read" }, input: { requestedPrincipalId: "them", callerPrincipalId: "me" } }),
    { allowed: false, reason: "no_grant" }
  );
  assert.deepEqual(
    await resolveUserLayerReadTarget({ deps: { ...deps, authorize: authorizeWith(true), permission: "custom.user.read" }, input: { requestedPrincipalId: "them", callerPrincipalId: "me" } }),
    { allowed: true, principalId: "them" }
  );
  assert.deepEqual(seen[0], { principalId: "me", permission: "custom.user.read", workspaceId: "workspace-local", entityType: "setting-value" });
});

class FirstError extends Error {}
class SecondError extends Error {}

test("respondToSettingsError: the first matching mapping wins and carries the error's own message", () => {
  const { res, capture } = createCapturingResponse();
  respondToSettingsError({ response: res, error: new SecondError("definition 'x' is gone"), mappings: [
    { matches: (e) => e instanceof FirstError, status: 404, code: "FIRST" },
    { matches: (e) => e instanceof SecondError, status: 409, code: "SECOND" },
    { matches: () => true, status: 400, code: "CATCH_ALL" },
  ] });
  assert.equal(capture.statusCode, 409);
  assert.deepEqual(capture.jsonBody, { error: "definition 'x' is gone", code: "SECOND" });
});

test("respondToSettingsError: an unmapped error is a fixed 500 that never echoes its message", () => {
  const { res, capture } = createCapturingResponse();
  respondToSettingsError({ response: res, error: new Error("connection to db at postgres://secret@host failed"), mappings: [
    { matches: (e) => e instanceof FirstError, status: 404, code: "FIRST" },
  ] });
  assert.equal(capture.statusCode, 500);
  assert.deepEqual(capture.jsonBody, { error: "internal error", code: "INTERNAL_ERROR" });
});
