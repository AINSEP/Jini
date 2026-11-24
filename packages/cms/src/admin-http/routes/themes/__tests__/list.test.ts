import { describe, expect, it } from "vitest";

import { InMemoryPresentationSettingsRepo } from "../../../../presentation/index.js";
import { themesListRoute, type ThemeListSource, type ThemesListRouteDeps } from "../list.js";
import { PRINCIPAL, raw, recordingAuthorize, signal, WORKSPACE_ID } from "./helpers.js";

function theme(id: string, source: string, errors: string[] = []): ThemeListSource {
  return { manifest: { id, name: `Theme ${id}`, version: "2.3.4" }, source, status: errors.length ? "invalid" : "valid", errors };
}

function makeDeps(themes: ThemeListSource[], activeThemeId: string | null): ThemesListRouteDeps {
  const rows = activeThemeId === null ? [] : [{ workspaceId: WORKSPACE_ID, activeThemeId, updatedAt: "2026-11-01T00:00:00.000Z" }];
  return {
    workspaceId: WORKSPACE_ID,
    presentationRepo: new InMemoryPresentationSettingsRepo({}, { initialRows: rows }),
    themes: () => themes,
    // A retired id (`basic`) resolves to its renamed theme, as the host's lookup does.
    findStoredTheme: ({ id }) => themes.find((t) => t.manifest.id === (id === "basic" ? "tovu-theme" : id)),
  };
}

const item = (id: string, source: string, active = false) => ({ id, name: `Theme ${id}`, version: "2.3.4", source, status: "valid", errors: [], active });

describe("themesListRoute", () => {
  it("keeps the method, path, default success status and no body cap, and takes no input", () => {
    expect(themesListRoute.method).toBe("get");
    expect(themesListRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/themes");
    expect(themesListRoute.successStatus).toBeUndefined();
    expect(themesListRoute.maxBodyBytes).toBeUndefined();
    expect(themesListRoute.parse(raw())).toEqual({ ok: true, value: {} });
  });

  it("sorts built-ins first, maps validator messages, resolves a retired active id and leaves the input order alone", async () => {
    const { authorize, calls } = recordingAuthorize();
    const themes = [theme("a-site", "site", ["manifest broken"]), theme("z-built", "built-in"), theme("tovu-theme", "site"), theme("b-built", "built-in")];
    const result = await themesListRoute.handle({ input: {}, deps: makeDeps(themes, "basic"), context: PRINCIPAL, authorize }, { signal });
    expect(calls).toEqual([{ permission: "theme.set", entityType: "presentation" }]);
    expect(result).toEqual({ ok: true, value: { themes: [
      item("b-built", "built-in"), item("z-built", "built-in"),
      { ...item("a-site", "site"), status: "invalid", errors: [{ code: null, file: null, message: "manifest broken" }] },
      item("tovu-theme", "site", true),
    ] } });
    expect(themes.map((t) => t.manifest.id)).toEqual(["a-site", "z-built", "tovu-theme", "b-built"]);
  });

  it.each([[null], ["unknown"]])("leaves every theme inactive for stored id %j (no settings-not-found 404)", async (activeThemeId) => {
    const result = await themesListRoute.handle({ input: {}, deps: makeDeps([theme("only", "site")], activeThemeId), context: PRINCIPAL, authorize: recordingAuthorize().authorize });
    expect(result).toEqual({ ok: true, value: { themes: [item("only", "site")] } });
  });

  it("reads nothing when authorization refuses, and fails closed without an authorizer", async () => {
    let reads = 0;
    const deps = { ...makeDeps([], null), presentationRepo: { findByWorkspaceId: async () => { reads += 1; return null; } } };
    await expect(themesListRoute.handle({ input: {}, deps, context: PRINCIPAL, authorize: recordingAuthorize(["theme.set"]).authorize })).rejects.toThrow("denied");
    await expect(themesListRoute.handle({ input: {}, deps, context: PRINCIPAL })).rejects.toThrow(/no authorizer/);
    expect(reads).toBe(0);
  });

  it("rethrows a settings read failure unchanged", async () => {
    const deps = { ...makeDeps([], null), presentationRepo: { findByWorkspaceId: async () => { throw new Error("secret db failure"); } } };
    await expect(themesListRoute.handle({ input: {}, deps, context: PRINCIPAL, authorize: recordingAuthorize().authorize })).rejects.toThrow("secret db failure");
  });
});
