import { describe, expect, it } from "vitest";

import { VERSION_CONFLICT_CODE } from "@jini-ai/core/optimistic-concurrency";
import { createVersionConflict } from "../version-conflict.js";
import { FakeRequestError as ApiError, isFakeRequestError } from "./request-error.fakes.js";

const { isVersionConflict, readVersionConflict } = createVersionConflict({ isRequestError: isFakeRequestError });

describe("isVersionConflict", () => {
  it("is true only for a 409 carrying the VERSION_CONFLICT code", () => {
    expect(isVersionConflict({ error: new ApiError({ message: "stale", status: 409 }, { code: VERSION_CONFLICT_CODE }) })).toBe(true);
  });

  it.each([
    ["a code-less 409 (slug already taken)", new ApiError({ message: "slug 'x' already exists", status: 409 })],
    ["a 409 with another code", new ApiError({ message: "bound", status: 409 }, { code: "MENU_LOCATION_BOUND" })],
    ["the code on a non-409", new ApiError({ message: "odd", status: 400 }, { code: VERSION_CONFLICT_CODE })],
    ["a plain Error", new Error("stale")],
    ["a non-error value", "stale"],
    ["a 409 VERSION_CONFLICT shape that is not the host's request error", Object.assign(new Error("stale"), { status: 409, code: VERSION_CONFLICT_CODE })],
  ])("is false for %s", (_label, error) => {
    expect(isVersionConflict({ error })).toBe(false);
  });
});

describe("readVersionConflict", () => {
  /**
   * The trap this whole pair exists for: `PUT /posts/:id` returns 409 for BOTH a slug-uniqueness
   * collision and a stale version, from the same `PostConflictError` hierarchy. Only the version
   * one carries `code: "VERSION_CONFLICT"`, so a status-only check would send an operator into the
   * "someone else saved" flow for a duplicate slug — and, worse, tell them their edit is safe to
   * force through.
   */
  it("does NOT classify a slug-uniqueness 409 (same status, no code) as a version conflict", () => {
    const slugConflict = new ApiError({ message: "slug 'taken' already exists", status: 409 });
    expect(readVersionConflict({ error: slugConflict, attemptedStatus: undefined })).toBeNull();
  });

  it("classifies a 409 VERSION_CONFLICT, carrying both versions and the attempted status", () => {
    const err = new ApiError({ message: "post 'p1' was modified by another save (expected version 3, current version 4)", status: 409 }, { code: "VERSION_CONFLICT", body: {
      details: { expectedVersion: 3, currentVersion: 4 },
    } });
    expect(readVersionConflict({ error: err, attemptedStatus: "published" })).toEqual({
      expectedVersion: 3,
      currentVersion: 4,
      attemptedStatus: "published",
    });
  });

  it("still reports a conflict when the server sent the code but no details bag", () => {
    const err = new ApiError({ message: "stale", status: 409 }, { code: "VERSION_CONFLICT" });
    expect(readVersionConflict({ error: err, attemptedStatus: undefined })).toEqual({
      expectedVersion: null,
      currentVersion: null,
      attemptedStatus: undefined,
    });
  });

  it("ignores the code on a non-409 status, and any non-ApiError", () => {
    expect(readVersionConflict({ error: new ApiError({ message: "nope", status: 500 }, { code: "VERSION_CONFLICT" }), attemptedStatus: undefined })).toBeNull();
    expect(readVersionConflict({ error: new Error("network down"), attemptedStatus: undefined })).toBeNull();
    expect(readVersionConflict({ error: "not an error at all", attemptedStatus: undefined })).toBeNull();
  });

  it.each([undefined, {}, { details: null }, { details: { expectedVersion: "4", currentVersion: "5" } }])(
    "leaves unknown conflict versions null for body %j", (body) => {
      const error = new ApiError({ message: "stale save", status: 409 }, { code: "VERSION_CONFLICT", body });
      expect(readVersionConflict({ error: error, attemptedStatus: "published" })).toEqual({
        expectedVersion: null, currentVersion: null, attemptedStatus: "published",
      });
    },
  );

  it("keeps the available version when only the current version is missing", () => {
    const error = new ApiError({ message: "stale save", status: 409 }, { code: "VERSION_CONFLICT", body: { details: { expectedVersion: 4 } } });
    expect(readVersionConflict({ error: error, attemptedStatus: undefined })).toEqual({
      expectedVersion: 4, currentVersion: null, attemptedStatus: undefined,
    });
  });
});
