import { expect, it, vi } from "vitest";
import { inspectSiteKeyMaterial, revealSiteKeyMaterial } from "../material.js";

it("an invalid first-present key stops source inspection before a later valid key", () => {
  const readSiteKeySourceMaterial = vi.fn(({ source }: { source: { kind: string } }) => ({ raw: source.kind === "env" ? "invalid" : "aa".repeat(32), envVarName: "HOST_KEY" }));
  const required = { sources: [{ kind: "env" }, { kind: "file", path: "/key" }], env: () => ({}), readSiteKeySourceMaterial, siteKeyFilePathFrom: () => "/key" };
  expect(inspectSiteKeyMaterial(required)).toEqual({ active: false, source: "env", invalid: true, reason: "not-hex", keyFilePath: "/key", envVarName: "HOST_KEY" });
  expect(revealSiteKeyMaterial(required)).toEqual({ active: false, source: "env", invalid: true, reason: "not-hex", keyFilePath: "/key", envVarName: "HOST_KEY" });
  expect(readSiteKeySourceMaterial.mock.calls.map(([input]) => input.source.kind)).toEqual(["env", "env"]);
});
