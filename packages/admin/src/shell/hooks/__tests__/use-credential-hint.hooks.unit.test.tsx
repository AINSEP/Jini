import { renderHook } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { useCredentialHint, useStoredCredentialHint } from "../use-credential-hint.hooks";

/** The hooks own one rule: read the operator's locale and hand it to the host's copy. */
test("the hint is formatted with the operator's locale, and the hint is passed through unchanged", () => {
  const formatCredentialHint = vi.fn(({ hint, locale }: { hint: unknown; locale: string }) => (hint ? `${locale}:hint` : ""));
  const hint = { length: 1234, last4: "abcd" };
  expect(renderHook(() => useCredentialHint({ hint, formatCredentialHint, useAdminLocale: () => "de" })).result.current).toBe("de:hint");
  expect(formatCredentialHint).toHaveBeenCalledWith({ hint, locale: "de" });
  expect(renderHook(() => useCredentialHint({ formatCredentialHint, useAdminLocale: () => "en" })).result.current).toBe("");
  expect(formatCredentialHint).toHaveBeenLastCalledWith({ hint: undefined, locale: "en" });
});

test("the stored-hint formatter gets the locale as its optional bag and only the keys the caller set", () => {
  const storedCredentialHint = vi.fn(() => "…wxyz, 40 chars");
  const stored = { isSet: true, masked: "••••", tokenHint: { length: 40, last4: "wxyz" } };
  expect(renderHook(() => useStoredCredentialHint({ stored, storedCredentialHint, useAdminLocale: () => "fr" })).result.current).toBe("…wxyz, 40 chars");
  expect(storedCredentialHint).toHaveBeenLastCalledWith({ stored }, { locale: "fr" });
  renderHook(() => useStoredCredentialHint({ stored, storedKeyIsForOtherEndpoint: true, storedCredentialHint, useAdminLocale: () => "fr" }));
  expect(storedCredentialHint).toHaveBeenLastCalledWith({ stored, storedKeyIsForOtherEndpoint: true }, { locale: "fr" });
});
