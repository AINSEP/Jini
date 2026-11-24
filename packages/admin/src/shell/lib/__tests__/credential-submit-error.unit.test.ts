import { describe, expect, it } from "vitest";

import { createCredentialSubmitErrorClassifier } from "../credential-submit-error.js";
import { FakeRequestError as ApiError, isFakeRequestError } from "./request-error.fakes.js";

const classifyCredentialSubmitError = createCredentialSubmitErrorClassifier({ isRequestError: isFakeRequestError });

describe("publish credential cases", () => {
  it("recognizes DUPLICATE_LABEL via e.message (the dispatched contract's own shape: { error: 'DUPLICATE_LABEL' }, no separate code)", () => {
    const err = new ApiError({ message: "DUPLICATE_LABEL", status: 409 });
    expect(classifyCredentialSubmitError({ error: err })).toEqual({ kind: "duplicate-label" });
  });

  it("recognizes DUPLICATE_LABEL via e.code too (this codebase's usual { error, code } shape)", () => {
    const err = new ApiError({ message: "A credential with this label already exists.", status: 409 }, { code: "DUPLICATE_LABEL" });
    expect(classifyCredentialSubmitError({ error: err })).toEqual({ kind: "duplicate-label" });
  });

  it("recognizes VALIDATION and surfaces body.detail when present", () => {
    const err = new ApiError({ message: "VALIDATION", status: 400 }, { code: undefined, body: { error: "VALIDATION", detail: "accountId is required for cloudflare-pages" } });
    expect(classifyCredentialSubmitError({ error: err })).toEqual({ kind: "validation", detail: "accountId is required for cloudflare-pages" });
  });

  it("VALIDATION without a body.detail falls back to the error message itself, never throws or drops the failure", () => {
    const err = new ApiError({ message: "VALIDATION", status: 400 });
    expect(classifyCredentialSubmitError({ error: err })).toEqual({ kind: "validation", detail: "VALIDATION" });
  });

  it("falls through to 'generic' for an unrecognized ApiError and for a non-ApiError rejection", () => {
    expect(classifyCredentialSubmitError({ error: new ApiError({ message: "request failed (500)", status: 500 }) })).toEqual({ kind: "generic" });
    expect(classifyCredentialSubmitError({ error: new Error("network down") })).toEqual({ kind: "generic" });
    expect(classifyCredentialSubmitError({ error: "not even an Error" })).toEqual({ kind: "generic" });
  });
});

describe("source-control credential cases", () => {
  it("classifies a non-ApiError as generic", () => {
    expect(classifyCredentialSubmitError({ error: new Error("boom") })).toEqual({ kind: "generic" });
  });

  it("classifies a DUPLICATE_LABEL code as duplicate-label", () => {
    const err = new ApiError({ message: "dup", status: 409 }, { code: "DUPLICATE_LABEL" });
    expect(classifyCredentialSubmitError({ error: err })).toEqual({ kind: "duplicate-label" });
  });

  it("classifies a VALIDATION code, carrying the body's detail text", () => {
    const err = new ApiError({ message: "bad request", status: 400 }, { code: "VALIDATION", body: { detail: "token is required" } });
    expect(classifyCredentialSubmitError({ error: err })).toEqual({ kind: "validation", detail: "token is required" });
  });

  it("falls back to the message as detail when a VALIDATION error carries no body.detail", () => {
    const err = new ApiError({ message: "bad request", status: 400 }, { code: "VALIDATION" });
    expect(classifyCredentialSubmitError({ error: err })).toEqual({ kind: "validation", detail: "bad request" });
  });

  it("classifies any other ApiError as generic", () => {
    const err = new ApiError({ message: "server exploded", status: 500 });
    expect(classifyCredentialSubmitError({ error: err })).toEqual({ kind: "generic" });
  });
});
