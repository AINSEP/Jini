import { expect, test } from "vitest";
import {
  createPreviewRevisionCache,
  freshThemePreviewHtml,
  isThemeAssetPath,
  previewRevisionOf,
  runThemePreviewReload,
} from "../theme-preview-refresh.js";

test("preview html is re-pointed at the revision's asset directory, keeping queries and encoding the revision", () => {
  expect(freshThemePreviewHtml({ html: '<link href="/theme-assets/t/a.css?x=1"><b>/theme-assets/</b>', revision: "r 1" }))
    .toBe('<link href="/theme-preview-assets/r%201/t/a.css?x=1"><b>/theme-preview-assets/r%201/</b>');
});

test("theme asset paths and revision tokens are recognised exactly", () => {
  expect(["/theme-assets", "/theme-assets/x", "/theme-preview-assets/r/x"].map((path) => isThemeAssetPath({ path }))).toEqual([true, true, true]);
  expect([undefined, "/theme-assetsx", "/page/theme-assets/x"].map((path) => isThemeAssetPath({ path }))).toEqual([false, false, false]);
  expect([previewRevisionOf({ value: "ok_rev-1" }), previewRevisionOf({ value: "a".repeat(100) })]).toEqual(["ok_rev-1", "a".repeat(100)]);
  expect([undefined, 5, "", "a b", "a".repeat(101), ["x"]].map((value) => previewRevisionOf({ value }))).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
});

test("preview-revision-cache-never-evicts: only the most recent `limit` revisions are held", () => {
  const cache = createPreviewRevisionCache({ limit: 3 });
  for (const revision of ["a", "b", "c", "d"]) cache.remember({ revision });
  expect(["a", "b", "c", "d"].map((revision) => cache.has({ revision }))).toEqual([false, true, true, true]);
});

test("reload: a refused principal is forbidden and nothing is refreshed", async () => {
  let refreshed = 0;
  const asked: unknown[] = [];
  const out = await runThemePreviewReload({
    principalId: "p", workspaceId: "w",
    authorize: async (required) => { asked.push(required); return { allowed: false }; },
    refresh: () => { refreshed++; },
  });
  expect(out).toEqual({ kind: "forbidden", body: { error: "not authorized for 'theme.set'" } });
  expect(asked).toEqual([{ principalId: "p", workspaceId: "w", permission: "theme.set", entityType: "theme" }]);
  expect(refreshed).toBe(0);
});

test("reload: an allowed principal gets the refresh body; a failing refresh is reported, a throwing authorize propagates", async () => {
  const allow = async () => ({ allowed: true });
  expect(await runThemePreviewReload({ principalId: "p", workspaceId: "w", authorize: allow, refresh: () => ({ ok: 1 }) })).toEqual({ kind: "reloaded", body: { ok: 1 } });
  const boom = new Error("disk");
  expect(await runThemePreviewReload({ principalId: "p", workspaceId: "w", authorize: allow, refresh: () => { throw boom; } })).toEqual({ kind: "failed", error: boom });
  await expect(runThemePreviewReload({ principalId: "p", workspaceId: "w", authorize: async () => { throw boom; }, refresh: () => 1 })).rejects.toBe(boom);
});

test("a zero-capacity preview cache never trusts the newly remembered revision", () => {
  const cache = createPreviewRevisionCache({ limit: 0 });
  cache.remember({ revision: "first" });
  expect(cache.has({ revision: "first" })).toBe(false);
  cache.remember({ revision: "second" });
  expect(cache.has({ revision: "second" })).toBe(false);
});
