import { describe, expect, it } from "vitest";
import { PresentationSettingsNotFoundError, PresentationSettingsValidationError } from "../../../../presentation/presentation.js";
import { presentationPatchRoute, type PresentationPatchRouteDeps } from "../patch.js";
import { fakeTheme, PRINCIPAL, recordingAuthorize, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

/** @file PATCH presentation: body reading, `theme.set` direct check, the 400/404 ladder and the response projection. */

class StylingRequired extends Error {}

function fakeDeps(overrides: Partial<PresentationPatchRouteDeps> = {}) {
  const log: string[] = [];
  const beta = fakeTheme("beta", { pages: { home: "", contact: "" }, manifest: { templates: ["landing.html"] } });
  delete beta.manifest.apiVersion;
  const themes = [fakeTheme("alpha"), beta, fakeTheme("broken", { status: "invalid" })];
  const deps: PresentationPatchRouteDeps = {
    workspaceId: WORKSPACE_ID,
    setActiveTheme: async ({ activeThemeId, actorId }) => { log.push(`set ${activeThemeId} by ${actorId}`); return { settings: { workspaceId: WORKSPACE_ID, activeThemeId, updatedAt: "t" } }; },
    isThemeStylingRequired: ({ err }) => err instanceof StylingRequired,
    themes: () => themes,
    catalogThemeIds: () => ["alpha", "beta"],
    findStoredTheme: ({ id }) => { log.push(`find ${id}`); return themes.find((t) => t.manifest.id === id); },
    requestThemePreviewRefresh: () => { log.push("refresh"); },
    toPresentationResponse: (fields) => ({ wrapped: fields }),
    ...overrides,
  };
  return { deps, log };
}

const parse = (body: unknown) => presentationPatchRoute.parse({ body, query: {}, params: {} });
async function run(deps: PresentationPatchRouteDeps, activeThemeId = "beta", authorize = recordingAuthorize().authorize) {
  return presentationPatchRoute.handle({ input: { activeThemeId }, deps, context: PRINCIPAL, authorize }, { signal });
}

describe("presentationPatchRoute", () => {
  it("is a plain PATCH on the workspace presentation", () => {
    expect([presentationPatchRoute.method, presentationPatchRoute.path, presentationPatchRoute.successStatus, presentationPatchRoute.maxBodyBytes])
      .toEqual(["patch", "/api/admin/v1/workspaces/:workspaceId/presentation", undefined, undefined]);
  });

  it("reads activeThemeId as a string, defaulting to \"\" for a missing body or field (never refuses)", () => {
    expect(parse({ activeThemeId: "beta" })).toEqual({ ok: true, value: { activeThemeId: "beta" } });
    expect(parse({ activeThemeId: 7 })).toEqual({ ok: true, value: { activeThemeId: "7" } });
    expect(parse(null)).toEqual({ ok: true, value: { activeThemeId: "" } });
    expect(parse(undefined)).toEqual({ ok: true, value: { activeThemeId: "" } });
    expect(parse({})).toEqual({ ok: true, value: { activeThemeId: "" } });
  });

  it("asks theme.set on presentation, id-free, before writing", async () => {
    const { authorize, calls } = recordingAuthorize(["theme.set"]);
    const { deps, log } = fakeDeps();
    await expect(run(deps, "beta", authorize)).rejects.toThrow("denied theme.set");
    expect(calls).toEqual([{ permission: "theme.set", entityType: "presentation" }]);
    expect(log).toEqual([]);
  });

  it("writes as the principal, refreshes previews, and projects the NEW active theme with the read catalogue", async () => {
    const { deps, log } = fakeDeps();
    const result = await run(deps);
    expect(log).toEqual(["set beta by principal-1", "find beta", "refresh"]);
    expect(result).toEqual({ ok: true, value: { wrapped: {
      settings: { workspaceId: WORKSPACE_ID, activeThemeId: "beta", updatedAt: "t" },
      availableThemeIds: ["alpha", "beta"],
      availableThemes: [
        { id: "alpha", name: "Theme alpha", tier: "templated", apiVersion: 2 },
        { id: "beta", name: "Theme beta", tier: "templated", apiVersion: undefined },
      ],
      activeThemeTemplates: ["landing.html"],
      activeThemeStaticPageIds: ["home", "contact"],
    } } });
  });

  it("an active theme that is not stored answers empty template and page lists", async () => {
    const { deps } = fakeDeps();
    const result = await run(deps, "none");
    if (!result.ok) throw new Error("expected success");
    expect(result.value).toMatchObject({ wrapped: { activeThemeTemplates: [], activeThemeStaticPageIds: [] } });
  });

  it("maps validation and styling errors to a flat 400, a missing row to a flat 404, and rethrows the rest", async () => {
    const failing = (err: Error) => fakeDeps({ setActiveTheme: async () => { throw err; } }).deps;
    expect(await refusalOf(() => run(failing(new PresentationSettingsValidationError({ message: "bad id ''" }))))).toEqual({ status: 400, body: { error: "bad id ''" } });
    expect(await refusalOf(() => run(failing(new StylingRequired("needs styling"))))).toEqual({ status: 400, body: { error: "needs styling" } });
    expect(await refusalOf(() => run(failing(new PresentationSettingsNotFoundError({ message: "no row" }))))).toEqual({ status: 404, body: { error: "no row" } });
    await expect(run(failing(new Error("disk gone")))).rejects.toThrow("disk gone");
  });

  it("fails closed without an authorizer", async () => {
    await expect(presentationPatchRoute.handle({ input: { activeThemeId: "beta" }, deps: fakeDeps().deps, context: PRINCIPAL }, { signal })).rejects.toThrow(/no authorizer/);
  });
});

it("never changes the active theme without a principal to attribute it to", async () => {
  const { deps, log } = fakeDeps();
  await expect(presentationPatchRoute.handle({
    input: { activeThemeId: "beta" }, deps, authorize: recordingAuthorize().authorize,
  }, { signal })).rejects.toThrow(new Error("presentation admin route has no authenticated principal"));
  expect(log).toEqual([]);
});
