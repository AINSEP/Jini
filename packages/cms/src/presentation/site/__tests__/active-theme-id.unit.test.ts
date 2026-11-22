import assert from "node:assert/strict";
import { test } from "vitest";

import { InMemoryPresentationSettingsRepo, PresentationSettingsNotFoundError } from "../../index.js";
import { resolveActiveThemeId } from "../active-theme-id.js";

/**
 * @file Direct-invocation unit tests for `resolveActiveThemeId` (this dispatch). It IS reached
 * indirectly today — `pages.route.test.ts` exercises its happy path and its
 * `PresentationSettingsNotFoundError` -> `""` fallback through the `/welcome` and `/` routes — but
 * that file never imports this module by name, and neither of those two route tests forces the
 * one branch a route can't easily trigger: a repo failure that is NOT
 * `PresentationSettingsNotFoundError`, which this function must re-throw unchanged rather than
 * swallow. Testing all three outcomes directly, against the real function, closes that gap and
 * pins the file's own documented contract (its header) to executable assertions.
 */

test("resolveActiveThemeId: returns the workspace's stored activeThemeId when a row exists", async () => {
  const presentationRepo = new InMemoryPresentationSettingsRepo({}, { initialRows: [
    { workspaceId: "ws-1", activeThemeId: "atlas", updatedAt: "2026-07-15T00:00:00.000Z" },
  ] });
  const result = await resolveActiveThemeId({ presentationRepo, workspaceId: "ws-1" });
  assert.equal(result, "atlas");
});

test("resolveActiveThemeId: degrades to '' when the workspace has no presentation-settings row yet", async () => {
  const presentationRepo = new InMemoryPresentationSettingsRepo({}, { initialRows: [] });
  const result = await resolveActiveThemeId({ presentationRepo, workspaceId: "ws-1" });
  assert.equal(result, "");
});

test("resolveActiveThemeId: any OTHER repo error propagates uncaught, not silently degraded to ''", async () => {
  const failure = Object.assign(new TypeError("simulated repo failure", { cause: new Error("disk offline") }), { code: "DB_IOERR" });
  const failingRepo = {
    findByWorkspaceId: async () => {
      throw failure;
    },
    save: async () => {},
    listAll: async () => [],
  };
  await assert.rejects(
    resolveActiveThemeId({ presentationRepo: failingRepo, workspaceId: "ws-1" }),
    (error) => error === failure,
    "a real repo/DB failure must not be mistaken for the documented 'no row yet' case"
  );
});

test("resolveActiveThemeId: sanity — PresentationSettingsNotFoundError is exactly the error class this function narrows", async () => {
  const explicitlyThrowingRepo = {
    findByWorkspaceId: async () => {
      throw new PresentationSettingsNotFoundError({ message: "no row for this workspace" });
    },
    save: async () => {},
    listAll: async () => [],
  };
  const result = await resolveActiveThemeId({ presentationRepo: explicitlyThrowingRepo, workspaceId: "ws-1" });
  assert.equal(result, "");
});
