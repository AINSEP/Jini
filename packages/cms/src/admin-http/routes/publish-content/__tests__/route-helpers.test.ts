import { expect, it, vi } from "vitest";
import { knownMappedErrorResponse, mappedErrorResponse } from "../route-helpers.js";

it("first typed refusal wins without rendering unknown exceptions", () => {
  class Parent extends Error {} class Child extends Parent {}
  const table = [[Parent, 409, "FIRST"], [Child, 400, "SECOND"]] as const;
  expect(knownMappedErrorResponse({ err: new Child("safe"), table })).toEqual({ status: 409, body: { error: "safe", code: "FIRST" } });
  expect(knownMappedErrorResponse({ err: new Error("private driver detail"), table })).toBeUndefined();
});

it("answers a typed publish failure locally without exposing it to the incident reporter", () => {
  class PeerGone extends Error {}
  const incident = vi.fn(() => ({ status: 500, body: { error: "Incident recorded" } }));
  expect(mappedErrorResponse({ err: new PeerGone("Remote was removed"), table: [[PeerGone, 404, "PEER_NOT_FOUND"]],
    incident, operation: "publish" })).toStrictEqual({ status: 404, body: { error: "Remote was removed", code: "PEER_NOT_FOUND" } });
  expect(incident).not.toHaveBeenCalled();
});
