import { describe, expect, it } from "vitest";
import { GrantExceedsIssuerError, IdentityConflictError, IdentityForbiddenError, IdentityNotFoundError, IdentityValidationError, OwnerRequiredError } from "../../../../core/types.js";
import {
  hostRung, principalIdParam, rejectUserError, USER_CONFLICT_OWN_CODE, USER_FORBIDDEN, USER_GRANT_EXCEEDS_ISSUER, USER_NOT_FOUND,
  USER_NOT_FOUND_CODELESS, USER_OWNER_REQUIRED, USER_USERNAME_CONFLICT, USER_VALIDATION, userActorId,
} from "../shared.js";
import { HostSelfDeleteError, refusalOf } from "./helpers.js";

describe("users route shared rungs", () => {
  const cases: Array<[string, unknown, Parameters<typeof rejectUserError>[0]["rungs"][number], { status: number; body: unknown }]> = [
    ["forbidden", new IdentityForbiddenError({ message: "no", permission: "user.manage", reason: "missing" }), USER_FORBIDDEN,
      { status: 403, body: { error: "no", code: "FORBIDDEN", details: { permission: "user.manage", reason: "missing" } } }],
    ["grant clamp", new GrantExceedsIssuerError({ message: "clamp", offendingPermissions: ["a", "b"] }), USER_GRANT_EXCEEDS_ISSUER,
      { status: 403, body: { error: "clamp", code: "GRANT_EXCEEDS_ISSUER", details: { offendingPermissions: ["a", "b"] } } }],
    ["validation", new IdentityValidationError({ message: "bad" }), USER_VALIDATION, { status: 400, body: { error: "bad", code: "VALIDATION_ERROR" } }],
    ["not found", new IdentityNotFoundError({ message: "gone" }), USER_NOT_FOUND, { status: 404, body: { error: "gone", code: "RESOURCE_NOT_FOUND" } }],
    ["code-less not found", new IdentityNotFoundError({ message: "gone" }), USER_NOT_FOUND_CODELESS, { status: 404, body: { error: "gone" } }],
    ["owner required", new OwnerRequiredError({ message: "owner" }), USER_OWNER_REQUIRED, { status: 409, body: { error: "owner", code: "OWNER_REQUIRED" } }],
    ["username conflict", new IdentityConflictError({ message: "dup", code: "USER_IN_TRASH" }), USER_USERNAME_CONFLICT,
      { status: 409, body: { error: "dup", code: "RESOURCE_CONFLICT", details: { field: "username" } } }],
    ["own-code conflict", new IdentityConflictError({ message: "dup", code: "USER_IN_TRASH" }), USER_CONFLICT_OWN_CODE,
      { status: 409, body: { error: "dup", code: "USER_IN_TRASH", details: { field: "username" } } }],
    ["own-code conflict without a code", new IdentityConflictError({ message: "dup" }), USER_CONFLICT_OWN_CODE,
      { status: 409, body: { error: "dup", code: "RESOURCE_CONFLICT", details: { field: "username" } } }],
    ["host predicate", new HostSelfDeleteError("self"), hostRung({ matches: ({ err }) => err instanceof HostSelfDeleteError, status: 409, code: "SELF_DELETE" }),
      { status: 409, body: { error: "self", code: "SELF_DELETE" } }],
  ];
  for (const [name, err, rung, expected] of cases) {
    it(`maps ${name} to its exact flat body, key order included`, async () => {
      const refusal = await refusalOf(() => rejectUserError({ err, rungs: [rung] }));
      expect(refusal).toEqual(expected);
      expect(JSON.stringify(refusal.body)).toBe(JSON.stringify(expected.body));
    });
  }

  it("uses the first matching rung and rethrows an unmapped error unchanged", async () => {
    const err = new IdentityValidationError({ message: "bad" });
    expect((await refusalOf(() => rejectUserError({ err, rungs: [USER_NOT_FOUND, USER_VALIDATION, hostRung({ matches: () => true, status: 500 })] }))).status).toBe(400);
    const unmapped = new Error("db down");
    expect(() => rejectUserError({ err: unmapped, rungs: [USER_FORBIDDEN] })).toThrow(unmapped);
  });

  it("reads the actor id and the principal id param, failing closed without a principal", () => {
    expect(userActorId({ context: { id: "p1" } })).toBe("p1");
    expect(() => userActorId({ context: undefined })).toThrow(/no authenticated principal/);
    expect(principalIdParam({ principalId: "p1" })).toBe("p1");
    expect(principalIdParam({})).toBe("");
  });
});
