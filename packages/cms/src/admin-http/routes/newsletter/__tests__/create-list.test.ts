import { describe, expect, it } from "vitest";
import { newsletterCreateListRoute as route } from "../create-list.js";
import { baseDeps, fakeList, PRINCIPAL, raw, recordingAuthorize, refusalOf, WORKSPACE_ID } from "./helpers.js";

/** @file CREATE_LIST: two required strings refused in `parse` (before auth); the host's `saveList` decides the rest. */

const REFUSAL = { status: 400, body: { error: "name and slug are required strings", code: "VALIDATION_ERROR" } };

describe("newsletterCreateListRoute", () => {
  it("keeps the method and path and answers 201", () => {
    expect([route.method, route.path, route.successStatus, route.maxBodyBytes]).toEqual(["post", "/api/admin/v1/workspaces/:workspaceId/newsletter/lists", 201, undefined]);
  });

  it("parses the two strings and ignores everything else", () => {
    expect(route.parse(raw({}, { name: "Weekly", slug: "weekly", id: "forced", isDefault: true }))).toEqual({ ok: true, value: { name: "Weekly", slug: "weekly" } });
  });

  it("leaves empty and whitespace-only strings to the host service, which owns that rule", () => {
    expect(route.parse(raw({}, { name: "", slug: " \t " }))).toEqual({ ok: true, value: { name: "", slug: " \t " } });
  });

  it.each<readonly [string, unknown]>([
    ["a missing body", undefined],
    ["a null body", null],
    ["a missing name", { slug: "weekly" }],
    ["a missing slug", { name: "Weekly" }],
    ["a non-string name", { name: 1, slug: "weekly" }],
    ["a non-string slug", { name: "Weekly", slug: ["weekly"] }],
  ])("refuses %s with the host's flat 400", async (_label, body) => {
    expect(await refusalOf(() => route.parse(raw({}, body)))).toEqual(REFUSAL);
  });

  it("saves the parsed list in this workspace and answers it in the data envelope", async () => {
    const saved: unknown[] = [];
    const deps = { ...baseDeps(), saveList: async (input: unknown) => { saved.push(input); return { list: fakeList() }; } };
    const result = await route.handle({ input: { name: "Weekly", slug: "weekly" }, deps, context: PRINCIPAL, authorize: recordingAuthorize().authorize });
    expect(saved).toEqual([{ workspaceId: WORKSPACE_ID, name: "Weekly", slug: "weekly" }]);
    expect(result).toEqual({ ok: true, value: { data: fakeList() } });
  });
});
