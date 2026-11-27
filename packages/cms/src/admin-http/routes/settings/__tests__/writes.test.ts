import { describe, expect, it } from "vitest";
import {
  AliasDepthExceededError, DefinitionInvalidError, DefinitionNotFoundError, DefinitionTombstonedError, ForbiddenError, PrincipalNotFoundError,
  RenameRetypeConflictError, ScopeNotAllowedError, SecretNotSupportedError, ValueValidationFailedError,
} from "@jini-ai/core/settings";

import { settingsSetRoute } from "../set.js";
import { settingsClearRoute } from "../clear.js";
import { settingsResetRoute } from "../reset.js";
import { settingsRegisterDefinitionsRoute } from "../register-definitions.js";
import { FENCE, PRINCIPAL, baseDeps, invoke, recordingAuthorize, refusalOf } from "./helpers.js";

const BASE = "/api/admin/v1/workspaces/:workspaceId/settings";

function writeDeps({ fail }: { fail?: unknown } = {}) {
  const calls: Array<{ method: string; input: unknown }> = [];
  const record = (method: string, result: unknown) => async (input: unknown) => {
    calls.push({ method, input });
    if (fail) throw fail;
    return result as never;
  };
  return { calls, deps: { ...baseDeps(), settingsService: () => ({
    set: record("set", { value: "v", revisionSeq: 7 }), clear: record("clear", { revisionSeq: 8 }), reset: record("reset", { clearedCount: 2, revisionSeqs: [9, 10] }),
  }) } };
}

describe("settings write specs", () => {
  it("pin method, path and no body cap", () => {
    expect([settingsSetRoute, settingsClearRoute, settingsResetRoute, settingsRegisterDefinitionsRoute].map((r) => [r.method, r.path, r.successStatus, r.maxBodyBytes]))
      .toEqual([["put", `${BASE}/value`, undefined, undefined], ["delete", `${BASE}/value`, undefined, undefined], ["post", `${BASE}/reset`, undefined, undefined], ["post", `${BASE}/definitions`, undefined, undefined]]);
  });

  it("PUT value: 400 before authorization; falsy present values pass; authorizes the derived permission", async () => {
    const { deps, calls } = writeDeps();
    const auth = recordingAuthorize();
    expect(await refusalOf(() => invoke(settingsSetRoute, { deps, body: { namespace: "n", key: "k", scope: "workspace" }, authorize: auth.authorize })))
      .toEqual({ status: 400, body: { error: "namespace, key, scope (global|workspace|user), and valueJson are required", code: "VALIDATION_ERROR" } });
    expect(await refusalOf(() => invoke(settingsSetRoute, { deps, body: null, authorize: auth.authorize }))).toMatchObject({ status: 400 });
    expect(auth.calls).toEqual([]);
    expect(await invoke(settingsSetRoute, { deps, body: { namespace: "n", key: "k", scope: "workspace", valueJson: false }, authorize: auth.authorize }))
      .toEqual({ key: "n.k", scope: "workspace", value: "v", revisionSeq: 7 });
    expect(auth.calls).toEqual([{ permission: "settings.workspace.write", entityType: "setting-value" }]);
    expect(calls).toEqual([{ method: "set", input: { namespace: "n", key: "k", scope: "workspace", value: false, workspaceId: "ws-1", principalId: undefined, callerPrincipalId: PRINCIPAL.id, authWorkspaceId: "ws-1" } }]);
  });

  it("PUT value: a foreign body workspace is 400 before authorization; denial stops the write", async () => {
    const { deps, calls } = writeDeps();
    const denied = recordingAuthorize(["settings.workspace.write"]);
    expect(await refusalOf(() => invoke(settingsSetRoute, { deps, body: { namespace: "n", key: "k", scope: "workspace", valueJson: 1, workspaceId: "other" }, authorize: denied.authorize }))).toMatchObject({ status: 400, body: { code: "VALIDATION_ERROR" } });
    await expect(invoke(settingsSetRoute, { deps, body: { namespace: "n", key: "k", scope: "workspace", valueJson: 1 }, authorize: denied.authorize })).rejects.toThrow("denied");
    expect(calls).toEqual([]);
  });

  it("PUT value / DELETE value / POST reset / POST definitions: every mapped domain error keeps status, code and message; unmapped rethrown", async () => {
    const table: Array<[typeof settingsSetRoute | typeof settingsClearRoute | typeof settingsResetRoute, unknown, Array<[new (m: string, ...rest: string[]) => Error, number, string]>]> = [
      [settingsSetRoute, { namespace: "n", key: "k", scope: "global", valueJson: 1 }, [[PrincipalNotFoundError, 404, "PRINCIPAL_NOT_FOUND"], [DefinitionNotFoundError, 404, "DEFINITION_NOT_FOUND"], [DefinitionTombstonedError, 409, "DEFINITION_TOMBSTONED"], [ScopeNotAllowedError, 400, "SCOPE_NOT_ALLOWED"], [ValueValidationFailedError, 400, "VALUE_VALIDATION_FAILED"], [ForbiddenError, 403, "FORBIDDEN"]]],
      [settingsClearRoute, { namespace: "n", key: "k", scope: "global" }, [[PrincipalNotFoundError, 404, "PRINCIPAL_NOT_FOUND"], [DefinitionNotFoundError, 404, "DEFINITION_NOT_FOUND"], [DefinitionTombstonedError, 409, "DEFINITION_TOMBSTONED"], [ScopeNotAllowedError, 400, "SCOPE_NOT_ALLOWED"], [ForbiddenError, 403, "FORBIDDEN"]]],
      [settingsResetRoute, { namespace: "n", scope: "global" }, [[ForbiddenError, 403, "FORBIDDEN"]]],
    ];
    for (const [route, body, rungs] of table) {
      for (const [ErrorClass, status, code] of rungs) {
        const { deps } = writeDeps({ fail: new (ErrorClass as new (m: string) => Error)("domain says no") });
        expect(await refusalOf(() => invoke(route as typeof settingsSetRoute, { deps, body }))).toEqual({ status, body: { error: "domain says no", code } });
      }
      const { deps } = writeDeps({ fail: new Error("private backend") });
      await expect(invoke(route as typeof settingsSetRoute, { deps, body })).rejects.toThrow("private backend");
    }
    const { deps } = writeDeps({ fail: new ValueValidationFailedError("x") });
    await expect(invoke(settingsClearRoute, { deps, body: { namespace: "n", key: "k", scope: "global" } })).rejects.toThrow("x");
  });

  it("DELETE value and POST reset: validation copy, authorization and payloads", async () => {
    const { deps, calls } = writeDeps();
    expect(await refusalOf(() => invoke(settingsClearRoute, { deps, body: { namespace: "n", scope: "user" } })))
      .toEqual({ status: 400, body: { error: "namespace, key, and scope (global|workspace|user) are required", code: "VALIDATION_ERROR" } });
    expect(await refusalOf(() => invoke(settingsResetRoute, { deps, body: { namespace: "n", scope: "nope" } })))
      .toEqual({ status: 400, body: { error: "namespace and scope (global|workspace|user) are required", code: "VALIDATION_ERROR" } });
    const auth = recordingAuthorize();
    expect(await invoke(settingsClearRoute, { deps, body: { namespace: "n", key: "k", scope: "workspace" }, authorize: auth.authorize })).toEqual({ key: "n.k", scope: "workspace", value: null, revisionSeq: 8 });
    expect(await invoke(settingsResetRoute, { deps, body: { namespace: "n", scope: "workspace" }, authorize: auth.authorize })).toEqual({ namespace: "n", clearedCount: 2, revisionSeqs: [9, 10] });
    expect(auth.calls).toEqual([{ permission: "settings.workspace.write", entityType: "setting-value" }, { permission: "settings.reset.workspace", entityType: "setting-namespace" }]);
    expect(calls.map((c) => c.method)).toEqual(["clear", "reset"]);
  });

  it("every write runs the injected fence before validation and authorization", async () => {
    const { deps, calls } = writeDeps();
    for (const route of [settingsSetRoute, settingsClearRoute, settingsResetRoute]) {
      const auth = recordingAuthorize();
      expect(await refusalOf(() => invoke(route as typeof settingsSetRoute, { deps, body: { namespace: "test.owner-only" }, authorize: auth.authorize })))
        .toEqual({ status: 403, body: { error: FENCE.protected.error, code: "FORBIDDEN" } });
      expect(auth.calls).toEqual([]);
    }
    expect(calls).toEqual([]);
  });

  it("POST definitions: authorizes first, then 400s a non-array batch, an unknown op, and maps its own ladder", async () => {
    const writeServiceDeps = () => { throw new SecretNotSupportedError({ message: "no secrets" }); };
    const deps = { ...baseDeps(), writeServiceDeps: writeServiceDeps as never };
    const auth = recordingAuthorize();
    expect(await refusalOf(() => invoke(settingsRegisterDefinitionsRoute, { deps, body: {}, authorize: auth.authorize })))
      .toEqual({ status: 400, body: { error: "'definitions' must be an array", code: "VALIDATION_ERROR" } });
    expect(auth.calls).toEqual([{ permission: "settings.definitions.manage", entityType: "setting-definition" }]);
    expect(await refusalOf(() => invoke(settingsRegisterDefinitionsRoute, { deps, body: { definitions: [] } })))
      .toEqual({ status: 400, body: { error: "no secrets", code: "SECRET_NOT_SUPPORTED" } });
    for (const [ErrorClass, status, code] of [[DefinitionInvalidError, 400, "DEFINITION_INVALID"], [RenameRetypeConflictError, 409, "RENAME_RETYPE_CONFLICT"], [AliasDepthExceededError, 409, "ALIAS_DEPTH_EXCEEDED"], [DefinitionTombstonedError, 409, "DEFINITION_TOMBSTONED"], [ForbiddenError, 403, "FORBIDDEN"]] as const) {
      const failing = { ...baseDeps(), writeServiceDeps: (() => { throw new ErrorClass("m"); }) as never };
      expect(await refusalOf(() => invoke(settingsRegisterDefinitionsRoute, { deps: failing, body: { definitions: [] } }))).toEqual({ status, body: { error: "m", code } });
    }
    const ok = { ...baseDeps(), writeServiceDeps: (() => ({})) as never };
    expect(await refusalOf(() => invoke(settingsRegisterDefinitionsRoute, { deps: ok, body: { definitions: [{ namespace: "n", key: "k", op: "bogus" }] } })))
      .toEqual({ status: 400, body: { error: "unknown op 'bogus'", code: "VALIDATION_ERROR" } });
    expect(await invoke(settingsRegisterDefinitionsRoute, { deps: ok, body: { definitions: [] } })).toEqual({ applied: [] });
  });

  it("POST definitions: the code-owned fence answers before authorization", async () => {
    const deps = { ...baseDeps(), writeServiceDeps: (() => ({})) as never };
    const auth = recordingAuthorize();
    expect(await refusalOf(() => invoke(settingsRegisterDefinitionsRoute, { deps, body: { definitions: [{ namespace: "test.code-owned", key: "k" }] }, authorize: auth.authorize })))
      .toEqual({ status: 400, body: { error: FENCE.codeOwned.error, code: "TEST_CODE_OWNED" } });
    expect(auth.calls).toEqual([]);
  });
});

it.each([
  { body: null, error: "namespace, key, and scope (global|workspace|user) are required" },
  { body: { namespace: "n", key: "k", scope: "wrong" }, error: "namespace, key, and scope (global|workspace|user) are required" },
  { body: { namespace: "n", key: "k", scope: "workspace", workspaceId: "other" }, error: "workspaceId 'other' does not match this route's workspace; a settings write cannot target another workspace" },
])("CLEAR refuses invalid write input before authorization or write ($error)", async ({ body, error }) => {
  const { deps, calls } = writeDeps();
  const auth = recordingAuthorize();
  expect(await refusalOf(() => invoke(settingsClearRoute, { deps, body, authorize: auth.authorize }))).toStrictEqual({
    status: 400, body: { error, code: "VALIDATION_ERROR" },
  });
  expect(auth.calls).toEqual([]);
  expect(calls).toEqual([]);
});
