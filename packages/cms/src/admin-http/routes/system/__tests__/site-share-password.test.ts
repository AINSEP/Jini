import { expect, it } from "vitest";
import { savedKeysSameOrigin, savedShareRefusalStatus, savedShareUploadRefusal } from "../site-share-password.js";

it("requires exact serving origin in addition to browser same-origin facts", () => {
  expect(savedKeysSameOrigin({ origin: "https://site", host: "site", fetchSite: "same-origin", protocol: "https" })).toBe(true);
  expect(savedKeysSameOrigin({ origin: "http://site", host: "site", fetchSite: "same-origin", protocol: "https" })).toBe(false);
  expect(savedKeysSameOrigin({ origin: "https://foreign", host: "site", fetchSite: "same-origin", protocol: "https" })).toBe(false);
  expect(savedKeysSameOrigin({ origin: undefined, host: undefined, fetchSite: "same-origin", protocol: "https" })).toBe(false);
  expect(["NOT_FOUND", "FORBIDDEN", "OTHER"].map(code => savedShareRefusalStatus({ code }))).toEqual([404, 403, 400]);
  for (const type of ["entity.too.large", "encoding.unsupported", "entity.parse.failed", "request.aborted", "request.size.invalid"]) {
    expect(savedShareUploadRefusal({ error: { type } })).toEqual({ status: type === "entity.too.large" ? 413 : 400, code: type === "entity.too.large" ? "LIMIT_EXCEEDED" : "INVALID_INPUT" });
  }
  expect(savedShareUploadRefusal({ error: { type: "unknown" } })).toBeUndefined();
  expect(savedShareUploadRefusal({ error: null })).toBeUndefined();
});
