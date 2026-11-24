import { describe, expect, it } from "vitest";

import { themePagePublishRoute, type ThemePagePublishRouteDeps } from "../explore-page-publish.js";
import { baseDeps, FILE_ERROR_CASES, PRINCIPAL, raw, recordingAuthorize, refusalOf, signal, THEME_SET } from "./explore-helpers.js";

class FakePublicationError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) { super(message); }
}

function deps(set: ThemePagePublishRouteDeps["setThemePagePublished"] = ({ page, published }) => ({ page, published, publishedPages: published ? [page] : [] })) {
  const base = baseDeps();
  return { ...base, setThemePagePublished: set, isThemePagePublicationError: ({ err }: { err: unknown }) => err instanceof FakePublicationError };
}

const run = (d: ThemePagePublishRouteDeps, input: { themeId: string; page: string; published: unknown }, authorize = recordingAuthorize().authorize) =>
  themePagePublishRoute.handle({ input, deps: d, context: PRINCIPAL, authorize }, { signal });

describe("themePagePublishRoute", () => {
  it("keeps method, path, default success status and no own body cap", () => {
    expect([themePagePublishRoute.method, themePagePublishRoute.path, themePagePublishRoute.successStatus, themePagePublishRoute.maxBodyBytes])
      .toEqual(["post", "/api/admin/v1/workspaces/:workspaceId/themes/:themeId/page/publish", undefined, undefined]);
  });

  it("parses page/published leniently: missing body and params fall back, published stays raw", () => {
    expect(themePagePublishRoute.parse(raw({ themeId: "t1" }, { page: "about", published: true }))).toEqual({ ok: true, value: { themeId: "t1", page: "about", published: true } });
    expect(themePagePublishRoute.parse(raw({}, null))).toEqual({ ok: true, value: { themeId: "", page: "", published: undefined } });
  });

  it("authorizes theme.set id-free, then publishes through the injected service", async () => {
    const { authorize, calls } = recordingAuthorize();
    const result = await run(deps(), { themeId: "t1", page: "about", published: true }, authorize);
    expect(calls).toEqual([THEME_SET]);
    expect(result).toEqual({ ok: true, value: { page: "about", published: true, publishedPages: ["about"] } });
  });

  it("refuses an unknown theme 404 before the body check, then a non-boolean published 400", async () => {
    expect(await refusalOf(() => run(deps(), { themeId: "nope", page: "a", published: "yes" }))).toEqual({ status: 404, body: { error: "theme 'nope' was not found" } });
    expect(await refusalOf(() => run(deps(), { themeId: "t1", page: "a", published: "true" }))).toEqual({ status: 400, body: { error: "published must be a boolean", code: "INVALID_BODY" } });
  });

  it("answers the publication error's own status and code, maps file errors, rethrows the rest", async () => {
    const pub = deps(() => { throw new FakePublicationError("page 'a' is not publishable", 422, "NOT_PUBLISHABLE"); });
    expect(await refusalOf(() => run(pub, { themeId: "t1", page: "a", published: true }))).toEqual({ status: 422, body: { error: "page 'a' is not publishable", code: "NOT_PUBLISHABLE" } });
    for (const [err, refusal] of FILE_ERROR_CASES) {
      expect(await refusalOf(() => run(deps(() => { throw err; }), { themeId: "t1", page: "a", published: true }))).toEqual(refusal);
    }
    await expect(run(deps(() => { throw new Error("disk gone"); }), { themeId: "t1", page: "a", published: true })).rejects.toThrow("disk gone");
  });

  it("does nothing when authorization refuses, and fails closed without an authorizer", async () => {
    let calls = 0;
    const d = deps(() => { calls += 1; return { page: "a", published: true, publishedPages: [] }; });
    await expect(run(d, { themeId: "t1", page: "a", published: true }, recordingAuthorize(true).authorize)).rejects.toThrow("denied");
    await expect(themePagePublishRoute.handle({ input: { themeId: "t1", page: "a", published: true }, deps: d, context: PRINCIPAL })).rejects.toThrow(/no authorizer/);
    expect([calls, d.log]).toEqual([0, []]);
  });
});
