import { expect, it } from "vitest";
import { toPublicMemberResponse } from "../public-member-response.js";

it("serializes an allowlisted member and omits absent name on the wire", () => {
  const member = { id: "m", email: "m@example.test", status: "active" as const, workspaceId: "private", version: 2, emailVerifiedAt: "now", note: "private", passwordHash: "secret" };
  const result = toPublicMemberResponse({ member });
  expect(result).toEqual({ id: "m", email: "m@example.test", status: "active" });
  expect(Object.hasOwn(result, "name")).toBe(false);
  expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  expect(toPublicMemberResponse({ member: { ...member, name: "" } })).toEqual({ id: "m", email: "m@example.test", status: "active", name: "" });
});
