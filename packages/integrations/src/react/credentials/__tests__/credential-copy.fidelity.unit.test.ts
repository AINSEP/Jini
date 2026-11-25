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
