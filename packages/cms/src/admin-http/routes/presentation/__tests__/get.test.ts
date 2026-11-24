import { describe, expect, it } from "vitest";

import { applicableThemeTemplates } from "../../../../themes/template-applicability.js";
import { presentationGetRoute, type PresentationGetRouteDeps, type PresentationResponseFields } from "../get.js";
import { fakeTheme, presentationRepo, PRINCIPAL, raw, recordingAuthorize, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

/** Deps over a real in-memory repo; the host collaborators record what they are asked. */
function makeDeps(overrides: Partial<PresentationGetRouteDeps> = {}) {
  const themes = [
    fakeTheme("alpha", { manifest: { templateFor: { "post.html": ["post"], "page.html": ["page"] } } }),
    fakeTheme("bravo", { manifest: { tier: "static", apiVersion: 1 }, pages: {} }),
    fakeTheme("broken", { status: "invalid" }),
  ];
  const previewAsks: unknown[] = [];
  const deps: PresentationGetRouteDeps = {
    workspaceId: WORKSPACE_ID,
    presentationRepo: presentationRepo("alpha"),
    themes: () => themes,
    catalogThemeIds: () => ["alpha", "bravo"],
    findStoredTheme: ({ id }) => themes.find((theme) => theme.manifest.id === (id === "retired" ? "alpha" : id)),
    isPackageShippedTheme: ({ manifest }) => manifest.id === "alpha",
    previewCapturesEnabled: () => true,
    themeCardPreviewUrl: ({ theme, capturesEnabled }) => { previewAsks.push({ theme, capturesEnabled }); return theme.tier === "static" ? null : `/preview/${theme.id}.png`; },
    // Marks the injected DTO so the tests pin that the host's shaper (not a default) answers.
    toPresentationResponse: (fields: PresentationResponseFields) => ({ shapedByHost: true, ...fields }),
    applicableThemeTemplates,
    ...overrides,
  };
  return { deps, previewAsks };
}

describe("presentationGetRoute", () => {
  it("keeps the method, path, default success status and no body cap", () => {
    expect(presentationGetRoute.method).toBe("get");
    expect(presentationGetRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/presentation");
    expect(presentationGetRoute.successStatus).toBeUndefined();
    expect(presentationGetRoute.maxBodyBytes).toBeUndefined();
  });

  it("parses an absent kind as the full catalog and accepts post or page", () => {
    expect(presentationGetRoute.parse(raw())).toEqual({ ok: true, value: {} });
    expect(presentationGetRoute.parse(raw({ kind: "post" }))).toEqual({ ok: true, value: { kind: "post" } });
    expect(presentationGetRoute.parse(raw({ kind: "page" }))).toEqual({ ok: true, value: { kind: "page" } });
  });

  it.each([["product"], [""], [["post"]]])("refuses kind %j with the flat 400 body", async (kind) => {
    expect(await refusalOf(() => presentationGetRoute.parse(raw({ kind })))).toEqual({ status: 400, body: { error: "kind must be 'post' or 'page'" } });
  });

  it("authorizes theme.set on presentation, id-free, and answers the host-shaped settings", async () => {
    const { authorize, calls } = recordingAuthorize();
    const { deps, previewAsks } = makeDeps();
    const result = await presentationGetRoute.handle({ input: {}, deps, context: PRINCIPAL, authorize }, { signal });
    expect(calls).toEqual([{ permission: "theme.set", entityType: "presentation" }]);
    expect(result).toEqual({ ok: true, value: {
      shapedByHost: true,
      settings: { workspaceId: WORKSPACE_ID, activeThemeId: "alpha", updatedAt: "2026-11-01T00:00:00.000Z" },
      activeThemeTemplates: ["post.html", "page.html"],
      activeThemeStaticPageIds: ["about"],
      availableThemeIds: ["alpha", "bravo"],
      availableThemes: [
        { id: "alpha", name: "Theme alpha", tier: "templated", apiVersion: 2, builtIn: true, previewImageUrl: "/preview/alpha.png" },
        { id: "bravo", name: "Theme bravo", tier: "static", apiVersion: 1, builtIn: false, previewImageUrl: null },
      ],
    } });
    expect(previewAsks).toEqual([
      { theme: { dir: "/themes/alpha", id: "alpha", tier: "templated" }, capturesEnabled: true },
      { theme: { dir: "/themes/bravo", id: "bravo", tier: "static" }, capturesEnabled: true },
    ]);
  });

  it("filters the active theme's templates by kind and passes the host's captures switch through", async () => {
    const { deps, previewAsks } = makeDeps({ previewCapturesEnabled: () => false });
    const result = await presentationGetRoute.handle({ input: { kind: "page" }, deps, context: PRINCIPAL, authorize: recordingAuthorize().authorize });
    expect(result.ok && (result.value as PresentationResponseFields).activeThemeTemplates).toEqual(["page.html"]);
    expect(previewAsks.every((ask) => (ask as { capturesEnabled: boolean }).capturesEnabled === false)).toBe(true);
  });

  it("reports a stored retired id as the theme it resolves to, keeping the rest of the stored row", async () => {
    const { deps } = makeDeps({ presentationRepo: presentationRepo("retired") });
    const result = await presentationGetRoute.handle({ input: {}, deps, context: PRINCIPAL, authorize: recordingAuthorize().authorize });
    expect(result.ok && (result.value as PresentationResponseFields).settings).toEqual({ workspaceId: WORKSPACE_ID, activeThemeId: "alpha", updatedAt: "2026-11-01T00:00:00.000Z" });
  });

  it("keeps an unknown stored id and answers empty template and page lists", async () => {
    const { deps } = makeDeps({ presentationRepo: presentationRepo("gone") });
    const result = await presentationGetRoute.handle({ input: {}, deps, context: PRINCIPAL, authorize: recordingAuthorize().authorize });
    const value = result.ok ? (result.value as PresentationResponseFields) : undefined;
    expect(value?.settings.activeThemeId).toBe("gone");
    expect(value?.activeThemeTemplates).toEqual([]);
    expect(value?.activeThemeStaticPageIds).toEqual([]);
  });

  it("maps a missing settings row to the flat 404 with the domain's message", async () => {
    const { deps } = makeDeps({ presentationRepo: presentationRepo("alpha") });
    deps.presentationRepo = { ...deps.presentationRepo, findByWorkspaceId: async () => null };
    expect(await refusalOf(() => presentationGetRoute.handle({ input: {}, deps, context: PRINCIPAL, authorize: recordingAuthorize().authorize })))
      .toEqual({ status: 404, body: { error: `presentation settings for workspace '${WORKSPACE_ID}' were not found` } });
  });

  it("rethrows an unexpected repo failure unchanged", async () => {
    const { deps } = makeDeps();
    deps.presentationRepo = { ...deps.presentationRepo, findByWorkspaceId: async () => { throw new Error("boom"); } };
    await expect(presentationGetRoute.handle({ input: {}, deps, context: PRINCIPAL, authorize: recordingAuthorize().authorize })).rejects.toThrow("boom");
  });

  it("reads nothing when authorization refuses, and fails closed without an authorizer", async () => {
    let reads = 0;
    const { deps } = makeDeps();
    deps.presentationRepo = { ...deps.presentationRepo, findByWorkspaceId: async () => { reads += 1; return null; } };
    await expect(presentationGetRoute.handle({ input: {}, deps, context: PRINCIPAL, authorize: recordingAuthorize(["theme.set"]).authorize })).rejects.toThrow("denied");
    await expect(presentationGetRoute.handle({ input: {}, deps, context: PRINCIPAL })).rejects.toThrow(/no authorizer/);
    expect(reads).toBe(0);
  });
});
