import { describe, expect, it } from "vitest";
import { parsePageLimit, parseSections, siteProfileRoute, type SiteProfileBuildFn } from "../profile.js";
import { PRINCIPAL, recordingAuthorize, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

const refusalSync = (fn: () => unknown) => refusalOf(async () => fn());

const NAMES: readonly string[] = ["pages", "theme", "plugins", "settings", "contentTypes"];
const MAX = 200;
const raw = (query: Record<string, unknown> = {}, params: Record<string, string> = {}) => ({ body: undefined, query, params });
const flat = (error: string) => ({ status: 400, body: { error, code: "VALIDATION_ERROR" } });

/** An injected builder that records its arguments and answers a fixed profile. */
function fakeBuilder(answer: () => object = () => ({ sections: {} })) {
  const calls: Array<{ required: { principalId: string }; optional: unknown }> = [];
  const buildSiteProfile: SiteProfileBuildFn = async (required, optional = {}) => { calls.push({ required, optional }); return answer(); };
  return { calls, buildSiteProfile };
}

const depsWith = (buildSiteProfile: SiteProfileBuildFn) => ({ workspaceId: WORKSPACE_ID, sectionNames: NAMES, maxPageItems: MAX, buildSiteProfile });
/** `context: null` means no session (an explicit `undefined` would just pick the default principal). */
const run = (query: Record<string, unknown>, deps: ReturnType<typeof depsWith>, { context = PRINCIPAL, authorize = recordingAuthorize().authorize }: { context?: { id: string } | null; authorize?: Parameters<typeof siteProfileRoute.handle>[0]["authorize"] } = {}) =>
  siteProfileRoute.handle({ input: { sections: query.sections, pageLimit: query.pageLimit }, deps, context: context ?? undefined, authorize }, { signal });

describe("siteProfileRoute", () => {
  it("is a plain GET with no body cap or custom status, and parse hands the two raw query values to handle", () => {
    expect(siteProfileRoute.method).toBe("get");
    expect(siteProfileRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/site/profile");
    expect(siteProfileRoute.successStatus).toBeUndefined();
    expect(siteProfileRoute.maxBodyBytes).toBeUndefined();
    expect(siteProfileRoute.parse(raw())).toEqual({ ok: true, value: { sections: undefined, pageLimit: undefined } });
    expect(siteProfileRoute.parse(raw({ sections: ["a", "b"], pageLimit: "5", other: 1 }))).toEqual({ ok: true, value: { sections: ["a", "b"], pageLimit: "5" } });
  });

  it("builds the profile as the authenticated principal and answers exactly what the builder returns", async () => {
    const profile = { sections: { pages: { status: "ok" } } };
    const { calls, buildSiteProfile } = fakeBuilder(() => profile);
    const result = await run({ sections: "pages", pageLimit: "2" }, depsWith(buildSiteProfile));
    expect(calls).toEqual([{ required: { principalId: PRINCIPAL.id }, optional: { sections: ["pages"], pageLimit: 2 } }]);
    if (!result.ok) throw new Error("expected success");
    expect(result.value).toBe(profile);
  });

  it("passes undefined sections and pageLimit when the caller scoped nothing (every section, builder default cap)", async () => {
    const { calls, buildSiteProfile } = fakeBuilder();
    await run({}, depsWith(buildSiteProfile));
    expect(calls[0]?.optional).toEqual({ sections: undefined, pageLimit: undefined });
  });

  it("never asks the host to authorize: each section is authorized inside the builder against its own permission", async () => {
    const { calls: authCalls, authorize } = recordingAuthorize();
    const { buildSiteProfile } = fakeBuilder();
    await run({}, depsWith(buildSiteProfile), { authorize });
    await siteProfileRoute.handle({ input: { sections: undefined, pageLimit: undefined }, deps: depsWith(buildSiteProfile), context: PRINCIPAL }, { signal });
    expect(authCalls).toEqual([]);
  });

  it("refuses an unknown section or a bad pageLimit with a flat 400 VALIDATION_ERROR and never builds", async () => {
    const { calls, buildSiteProfile } = fakeBuilder();
    const deps = depsWith(buildSiteProfile);
    expect(await refusalOf(() => run({ sections: "pages,Theme" }, deps))).toEqual(flat("unknown section 'Theme' — valid sections are: pages, theme, plugins, settings, contentTypes"));
    expect(await refusalOf(() => run({ sections: { a: "pages" } }, deps))).toEqual(flat("sections must be a comma-separated string of section names"));
    expect(await refusalOf(() => run({ pageLimit: "201" }, deps))).toEqual(flat("pageLimit must be an integer between 1 and 200, got '201'"));
    for (const bad of ["0", "1.5", "abc", ""]) {
      expect(await refusalOf(() => run({ pageLimit: bad }, deps))).toEqual(flat(`pageLimit must be an integer between 1 and 200, got '${bad}'`));
    }
    expect(await refusalOf(() => run({ pageLimit: ["5", "6"] }, deps))).toEqual(flat("pageLimit must be a single integer value"));
    expect(calls).toEqual([]);
  });

  it("checks sections before pageLimit, so a request wrong in both names the section", async () => {
    const { buildSiteProfile } = fakeBuilder();
    expect(await refusalOf(() => run({ sections: "nope", pageLimit: "0" }, depsWith(buildSiteProfile)))).toMatchObject({ status: 400, body: { error: expect.stringContaining("unknown section 'nope'") } });
  });

  it("reads the principal before the query: no session fails closed (the host's 500), even with a bad query", async () => {
    const { calls, buildSiteProfile } = fakeBuilder();
    await expect(run({ sections: "nope" }, depsWith(buildSiteProfile), { context: null })).rejects.toThrow(/no authenticated principal/);
    expect(calls).toEqual([]);
  });

  it("uses the vocabulary and cap the host injected, not a default", async () => {
    const { buildSiteProfile } = fakeBuilder();
    const deps = { ...depsWith(buildSiteProfile), sectionNames: ["only"], maxPageItems: 3 };
    expect(await refusalOf(() => run({ sections: "pages" }, deps))).toEqual(flat("unknown section 'pages' — valid sections are: only"));
    expect(await refusalOf(() => run({ pageLimit: "4" }, deps))).toEqual(flat("pageLimit must be an integer between 1 and 3, got '4'"));
  });

  it("rethrows a builder failure unchanged so the host answers its fixed redacted 500", async () => {
    const { buildSiteProfile } = fakeBuilder(() => { throw new Error("clock exploded at /private/var/site.db"); });
    await expect(run({}, depsWith(buildSiteProfile))).rejects.toThrow("clock exploded at /private/var/site.db");
  });
});

describe("parseSections", () => {
  it("absent or blank means every section (undefined), never an empty selection", () => {
    for (const blank of [undefined, "", " , ,"]) expect(parseSections({ raw: blank, sectionNames: NAMES })).toBeUndefined();
  });

  it("trims names and merges a repeated ?sections= param in order", () => {
    expect(parseSections({ raw: " theme , pages ", sectionNames: NAMES })).toEqual(["theme", "pages"]);
    expect(parseSections({ raw: ["theme", "plugins,settings"], sectionNames: NAMES })).toEqual(["theme", "plugins", "settings"]);
  });

  it("refuses an unknown name on the first offender and any non-string part (a nested query object, a mixed array)", async () => {
    expect(await refusalSync(() => parseSections({ raw: "pages,Theme,other", sectionNames: NAMES }))).toEqual(flat("unknown section 'Theme' — valid sections are: pages, theme, plugins, settings, contentTypes"));
    expect(await refusalSync(() => parseSections({ raw: ["pages", 3], sectionNames: NAMES }))).toEqual(flat("sections must be a comma-separated string of section names"));
  });
});

describe("parsePageLimit", () => {
  it("accepts 1 and the injected maximum inclusive; absence is undefined", () => {
    expect(parsePageLimit({ raw: undefined, maxPageItems: MAX })).toBeUndefined();
    expect(parsePageLimit({ raw: "1", maxPageItems: MAX })).toBe(1);
    expect(parsePageLimit({ raw: "200", maxPageItems: MAX })).toBe(200);
  });

  it("refuses one past the maximum, a repeated param and a non-integer", async () => {
    expect(await refusalSync(() => parsePageLimit({ raw: "201", maxPageItems: MAX }))).toEqual(flat("pageLimit must be an integer between 1 and 200, got '201'"));
    expect(await refusalSync(() => parsePageLimit({ raw: ["5", "6"], maxPageItems: MAX }))).toEqual(flat("pageLimit must be a single integer value"));
    expect(await refusalSync(() => parsePageLimit({ raw: "2.5", maxPageItems: MAX }))).toEqual(flat("pageLimit must be an integer between 1 and 200, got '2.5'"));
  });
});
