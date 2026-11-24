import { describe, expect, it } from "vitest";

import { themeRescanRoute, type ThemeRescanRouteDeps } from "../rescan-themes.js";
import { PRINCIPAL, raw, recordingAuthorize, signal, WORKSPACE_ID } from "./helpers.js";

/** Deps whose rescan records the order the route asks the host for each list. */
function makeDeps(order: string[] = []): ThemeRescanRouteDeps {
  return {
    workspaceId: WORKSPACE_ID,
    rescanThemes: () => { order.push("rescan"); return { added: ["new"], removed: ["old"], total: 3 }; },
    catalogThemeIds: () => { order.push("catalog"); return ["alpha", "new"]; },
    duplicateThemeIds: () => { order.push("duplicates"); return ["alpha"]; },
  };
}

describe("themeRescanRoute", () => {
  it("keeps the method, path, default success status and no body cap, and takes no input", () => {
    expect(themeRescanRoute.method).toBe("post");
    expect(themeRescanRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/themes/rescan");
    expect(themeRescanRoute.successStatus).toBeUndefined();
    expect(themeRescanRoute.maxBodyBytes).toBeUndefined();
    expect(themeRescanRoute.parse(raw())).toEqual({ ok: true, value: {} });
  });

  it("authorizes theme.set on presentation, rescans first, then reports the refreshed lists", async () => {
    const { authorize, calls } = recordingAuthorize();
    const order: string[] = [];
    const result = await themeRescanRoute.handle({ input: {}, deps: makeDeps(order), context: PRINCIPAL, authorize }, { signal });
    expect(calls).toEqual([{ permission: "theme.set", entityType: "presentation" }]);
    expect(order).toEqual(["rescan", "catalog", "duplicates"]);
    expect(result).toEqual({ ok: true, value: { added: ["new"], removed: ["old"], total: 3, availableThemeIds: ["alpha", "new"], duplicateIds: ["alpha"] } });
  });

  it("does not rescan when authorization refuses, and fails closed without an authorizer", async () => {
    const order: string[] = [];
    await expect(themeRescanRoute.handle({ input: {}, deps: makeDeps(order), context: PRINCIPAL, authorize: recordingAuthorize(["theme.set"]).authorize })).rejects.toThrow("denied");
    await expect(themeRescanRoute.handle({ input: {}, deps: makeDeps(order), context: PRINCIPAL })).rejects.toThrow(/no authorizer/);
    expect(order).toEqual([]);
  });

  it("rethrows a rescan failure unchanged", async () => {
    const deps = { ...makeDeps(), rescanThemes: () => { throw new Error("simulated rescan failure"); } };
    await expect(themeRescanRoute.handle({ input: {}, deps, context: PRINCIPAL, authorize: recordingAuthorize().authorize })).rejects.toThrow("simulated rescan failure");
  });
});
