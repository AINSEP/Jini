import { expect, it, vi } from "vitest";
import { memberPageRoute } from "../member-pages.js";

it("marks the account private before checking its live session", async () => {
  const calls: string[] = [];
  const deps = { workspaceId: "w", pages: { "/account": { id: "id", title: "Account", body: "account" } }, accountPath: "/account", signInLocation: "/signin#redirect=%2Faccount", markPrivate: () => { calls.push("private"); }, hasLiveSession: async () => { calls.push("session"); return false; } };
  expect(await memberPageRoute.handle({ path: "/account/", deps })).toEqual({ kind: "redirect", status: 303, location: "/signin#redirect=%2Faccount" });
  expect(calls).toEqual(["private", "session"]);
  const fail = vi.fn(async () => { throw new Error("session"); });
  calls.length = 0;
  await expect(memberPageRoute.handle({ path: "/account", deps: { ...deps, hasLiveSession: fail } })).rejects.toThrow("session");
  expect(calls).toEqual(["private"]);
});
