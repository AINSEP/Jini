import { expect, it } from "vitest";
import { consentRevisionToken } from "../request.js";

it("omission is not a nullable revision token", () => {
  expect(() => consentRevisionToken({ input: {}, key: "revision" })).toThrow("revision must be a revision id or null.");
  expect(consentRevisionToken({ input: { revision: null }, key: "revision" })).toBeNull();
});
