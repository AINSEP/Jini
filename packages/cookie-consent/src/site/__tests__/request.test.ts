import { expect, it, vi } from "vitest";
import { ToolInputError } from "@jini-ai/core";
import { consentPagePath, consentRevisionToken, readConsentRequest } from "../request.js";

it("omission is not a nullable revision token", () => {
  expect(() => consentRevisionToken({ input: {}, key: "revision" })).toThrow("revision must be a revision id or null.");
  expect(consentRevisionToken({ input: { revision: null }, key: "revision" })).toBeNull();
});

it("accepts declared request fields and refuses unknown fields or non-object bodies", () => {
  const fields = ["revision", "path"];
  const valid = { revision: null, path: "/privacy" };
  expect(readConsentRequest({ body: valid, fields })).toEqual(valid);
  expect(() => readConsentRequest({ body: { ...valid, overwrite: true }, fields })).toThrow(ToolInputError);
  expect(() => readConsentRequest({ body: { ...valid, overwrite: true }, fields })).toThrow("Unknown consent request field.");
  for (const body of [null, [], "revision", 42]) {
    expect(() => readConsentRequest({ body, fields })).toThrow("Request must be a JSON object.");
  }
});

it("accepts an opaque revision id and refuses keys outside the revision token format", () => {
  expect(consentRevisionToken({ input: { revision: "rA_12-d" }, key: "revision" })).toBe("rA_12-d");
  for (const revision of ["", "r".repeat(65), "revision/id", 9]) {
    expect(() => consentRevisionToken({ input: { revision }, key: "revision" })).toThrow("revision must be a revision id or null.");
  }
});

it("uses the host-normalized public path and replaces resolver failures with safe copy", () => {
  const resolvePath = vi.fn(({ raw }: { raw: string }) => {
    if (raw === "/privacy/") return "/privacy";
    throw new Error("private routing details");
  });
  expect(consentPagePath({ path: "/privacy/", resolvePath })).toBe("/privacy");
  const invalid = () => consentPagePath({ path: "/api/receipts", resolvePath });
  expect(invalid).toThrow(ToolInputError);
  expect(invalid).toThrow("Choose a local public page path without traversal, API paths, or an external URL.");
  expect(resolvePath.mock.calls.map(([args]) => args)).toEqual([{ raw: "/privacy/" }, { raw: "/api/receipts" }, { raw: "/api/receipts" }]);
});
