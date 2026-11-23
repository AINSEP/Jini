import { describe, expect, it } from "vitest";
import { EntityNotLiveError } from "../../../../core/entity-liveness.js";
import { RedirectConflictError, RedirectLoopError, RedirectTargetNotAllowedError, RedirectValidationError } from "../../../../redirects/index.js";
import { matchRedirectError, REDIRECT_WRITE_ERROR_MAPPINGS, rejectRedirectError, type RedirectErrorMapping } from "../shared.js";
import { refusalOf } from "./helpers.js";

describe("redirect write-error mapping", () => {
  it("maps each chokepoint error to its status/code with the error's own message", () => {
    const cases: Array<[unknown, number, string]> = [
      [new EntityNotLiveError({ entityType: "redirect", entityId: "r", state: "trashed" }), 409, "ENTITY_IN_TRASH"],
      [new RedirectValidationError("bad"), 400, "REDIRECT_VALIDATION_ERROR"],
      [new RedirectTargetNotAllowedError("bad"), 400, "REDIRECT_TARGET_NOT_ALLOWED"],
      [new RedirectConflictError("bad"), 409, "REDIRECT_CONFLICT"],
      [new RedirectLoopError("bad"), 409, "REDIRECT_LOOP_DETECTED"],
    ];
    for (const [err, status, code] of cases) {
      expect(matchRedirectError({ err, mappings: REDIRECT_WRITE_ERROR_MAPPINGS })).toEqual({ status, error: (err as Error).message, code });
    }
  });

  it("matches a non-Error value by its string form, and nothing for an unmapped error", () => {
    const custom: RedirectErrorMapping[] = [{ matches: ({ err }) => err === "teapot", status: 418, code: "TEAPOT" }];
    expect(matchRedirectError({ err: "teapot", mappings: custom })).toEqual({ status: 418, error: "teapot", code: "TEAPOT" });
    expect(matchRedirectError({ err: new Error("x"), mappings: REDIRECT_WRITE_ERROR_MAPPINGS })).toBeUndefined();
  });

  it("rejectRedirectError refuses a mapped error and rethrows anything else unchanged", async () => {
    expect(await refusalOf(() => rejectRedirectError({ err: new RedirectConflictError("dup"), mappings: REDIRECT_WRITE_ERROR_MAPPINGS }))).toEqual({ status: 409, body: { error: "dup", code: "REDIRECT_CONFLICT" } });
    const unexpected = new Error("crash");
    expect(() => rejectRedirectError({ err: unexpected, mappings: REDIRECT_WRITE_ERROR_MAPPINGS })).toThrow(unexpected);
  });
});
