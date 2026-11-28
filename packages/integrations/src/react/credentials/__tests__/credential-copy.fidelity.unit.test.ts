import { expect, test, vi } from "vitest";
import { storedCredentialHint } from "../credential-copy.js";

test("stored metadata is formatted without reconstructing a credential", () => {
  const formatHint = vi.fn(() => "server hint");
  const stored = { isSet: true, masked: "••••abcd", tokenHint: null };
  expect(storedCredentialHint({ stored, formatHint }, { locale: "de" })).toBe("server hint");
  expect(formatHint).toHaveBeenCalledWith({ hint: null, locale: "de" });
  expect(storedCredentialHint({ stored, formatHint, storedKeyIsForOtherEndpoint: true })).toBeUndefined();
  expect(formatHint).toHaveBeenCalledTimes(1);
});

test("a legacy server mask is the fallback only when the formatter has nothing to say", () => {
  const formatHint = vi.fn(() => "");
  expect(storedCredentialHint({ stored: { isSet: true, masked: "••••wxyz" }, formatHint })).toBe("••••wxyz");
  expect(formatHint).toHaveBeenLastCalledWith({ hint: undefined, locale: "en" });
  expect(storedCredentialHint({ stored: { isSet: true, masked: null, tokenHint: null }, formatHint })).toBeUndefined();
  expect(formatHint).toHaveBeenCalledTimes(2);
});

test("no stored key, or a key marked unset, never asks the formatter", () => {
  const formatHint = vi.fn(() => "server hint");
  expect(storedCredentialHint({ stored: null, formatHint })).toBeUndefined();
  expect(storedCredentialHint({ stored: { isSet: false, masked: "••••abcd" }, formatHint })).toBeUndefined();
  expect(formatHint).not.toHaveBeenCalled();
});
