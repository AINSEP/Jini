import { expect, it } from "vitest";
import { CustomCredentialValidationError } from "../../credentialed-http/sets/store.js";
import { cleanCardToken, TOKEN_PASTE_AGAIN_MESSAGE } from "../card-token.js";

/** @file A pasted card token loses edge whitespace and zero-width junk; interior junk still refuses without quoting the token. */

it("strips edge whitespace and zero-width characters", () => {
  expect(cleanCardToken({ token: "​ sk_live_abc\n﻿" })).toBe("sk_live_abc");
});

it("returns an empty string for an all-junk token", () => {
  expect(cleanCardToken({ token: " ‍\t" })).toBe("");
});

it("refuses an interior non-visible-ASCII character with the paste-again message", () => {
  expect(() => cleanCardToken({ token: "sk_live​abc" })).toThrow(CustomCredentialValidationError);
  expect(() => cleanCardToken({ token: "sk live" })).toThrow(TOKEN_PASTE_AGAIN_MESSAGE);
});
