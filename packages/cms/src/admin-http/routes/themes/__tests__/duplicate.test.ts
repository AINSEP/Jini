import { describe, expect, it } from "vitest";

import { THEME_DUPLICATE_ERROR_STATUS, themeDuplicateRoute, type ThemeDuplicateRefusalCode, type ThemeDuplicateRouteDeps } from "../duplicate.js";
import { PRINCIPAL, raw, recordingAuthorize, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

/** A host refusal the injected recognizer reads the code off. */
class FakeDuplicateError extends Error {
  constructor(readonly code: ThemeDuplicateRefusalCode) { super(`refused ${code}`); }
}

function makeDeps(order: string[] = [], overrides: Partial<ThemeDuplicateRouteDeps> = {}): ThemeDuplicateRouteDeps {
  return {
    workspaceId: WORKSPACE_ID,
    duplicateTheme: (required, optional) => {
      order.push(`duplicate:${JSON.stringify({ ...required, ...optional })}`);
      return { result: { id: "copy", name: required.newName, tier: "static", sourceThemeId: required.sourceThemeId, files: 7 }, theme: { status: "valid", errors: [] } };
    },
    refreshThemePreviews: () => { order.push("refresh"); },
    catalogThemeIds: () => { order.push("catalog"); return ["src", "copy"]; },
    duplicateThemeErrorCode: ({ err }) => (err instanceof FakeDuplicateError ? err.code : undefined),
    ...overrides,
  };
}

describe("themeDuplicateRoute", () => {
  it("keeps the method, path, 201 and no body cap", () => {
    expect(themeDuplicateRoute.method).toBe("post");
    expect(themeDuplicateRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/themes/:themeId/duplicate");
    expect(themeDuplicateRoute.successStatus).toBe(201);
    expect(themeDuplicateRoute.maxBodyBytes).toBeUndefined();
  });

  it("parses the source id, stringifies newName and keeps only a non-empty string newId", () => {
    expect(themeDuplicateRoute.parse(raw({ themeId: "src" }, { newName: "Copy", newId: "my-id" }))).toEqual({ ok: true, value: { sourceThemeId: "src", newName: "Copy", newId: "my-id" } });
    expect(themeDuplicateRoute.parse(raw({ themeId: "src" }, { newName: 123, newId: 42 }))).toEqual({ ok: true, value: { sourceThemeId: "src", newName: "123", newId: undefined } });
    for (const body of [undefined, null, [], { newName: null, newId: "" }]) {
      expect(themeDuplicateRoute.parse(raw({}, body))).toEqual({ ok: true, value: { sourceThemeId: "", newName: "", newId: undefined } });
    }
  });

  it("authorizes theme.edit on theme, duplicates, refreshes previews, then answers the copy and the catalogue", async () => {
    const { authorize, calls } = recordingAuthorize();
    const order: string[] = [];
    const input = { sourceThemeId: "src", newName: "Copy", newId: undefined };
    const result = await themeDuplicateRoute.handle({ input, deps: makeDeps(order), context: PRINCIPAL, authorize }, { signal });
    expect(calls).toEqual([{ permission: "theme.edit", entityType: "theme" }]);
    expect(order).toEqual([`duplicate:${JSON.stringify({ sourceThemeId: "src", newName: "Copy" })}`, "refresh", "catalog"]);
    expect(result).toEqual({ ok: true, value: {
      theme: { id: "copy", name: "Copy", tier: "static", status: "valid", errors: [] }, sourceThemeId: "src", files: 7, availableThemeIds: ["src", "copy"],
    } });
  });

  it("reports a copy discovery did not load as invalid with no errors", async () => {
    const deps = makeDeps([], { duplicateTheme: () => ({ result: { id: "c", name: "C", tier: "static", sourceThemeId: "s", files: 1 }, theme: undefined }) });
    const result = await themeDuplicateRoute.handle({ input: { sourceThemeId: "s", newName: "C", newId: "c" }, deps, context: PRINCIPAL, authorize: recordingAuthorize().authorize });
    expect(result.ok && result.value.theme).toEqual({ id: "c", name: "C", tier: "static", status: "invalid", errors: [] });
  });

  it.each(Object.entries(THEME_DUPLICATE_ERROR_STATUS))("maps refusal %s to its status with the error's message and code", async (code, status) => {
    const deps = makeDeps([], { duplicateTheme: () => { throw new FakeDuplicateError(code as ThemeDuplicateRefusalCode); } });
    expect(await refusalOf(() => themeDuplicateRoute.handle({ input: { sourceThemeId: "s", newName: "C", newId: undefined }, deps, context: PRINCIPAL, authorize: recordingAuthorize().authorize })))
      .toEqual({ status, body: { error: `refused ${code}`, code } });
  });

  it("pins the status table", () => {
    expect(THEME_DUPLICATE_ERROR_STATUS).toEqual({
      SOURCE_NOT_FOUND: 404, ID_TAKEN: 409, INVALID_NAME: 400, INVALID_ID: 400, SOURCE_NOT_COPYABLE: 400, SYMLINK: 400, TOO_LARGE: 400, BAD_MANIFEST: 400,
    });
  });

  it("rethrows an unrecognized failure, including one from the preview refresh", async () => {
    const deps = makeDeps([], { refreshThemePreviews: () => { throw new Error("refresh failed"); } });
    await expect(themeDuplicateRoute.handle({ input: { sourceThemeId: "s", newName: "C", newId: undefined }, deps, context: PRINCIPAL, authorize: recordingAuthorize().authorize })).rejects.toThrow("refresh failed");
  });

  it("copies nothing when authorization refuses, and fails closed without an authorizer", async () => {
    const order: string[] = [];
    const input = { sourceThemeId: "s", newName: "C", newId: undefined };
    await expect(themeDuplicateRoute.handle({ input, deps: makeDeps(order), context: PRINCIPAL, authorize: recordingAuthorize(["theme.edit"]).authorize })).rejects.toThrow("denied");
    await expect(themeDuplicateRoute.handle({ input, deps: makeDeps(order), context: PRINCIPAL })).rejects.toThrow(/no authorizer/);
    expect(order).toEqual([]);
  });
});
