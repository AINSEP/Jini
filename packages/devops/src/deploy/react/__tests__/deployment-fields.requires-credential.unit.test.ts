import { expect, test } from "vitest";
import { credentialFormReadyToSave, credentialVerifyStatusClass } from "../rules.js";

test("credential requires token and declared required fields; unreachable verification stays a warning", () => {
  const spec = { tokenField: "token", fields: [{ name: "account", label: "Account", required: true }] };
  expect(credentialFormReadyToSave({ spec, values: { token: "secret" } })).toBe(false);
  expect(credentialFormReadyToSave({ spec, values: { account: "account" } })).toBe(false);
  expect(credentialFormReadyToSave({ spec, values: { token: "secret", account: "account" } })).toBe(true);
  expect(credentialVerifyStatusClass({ row: { verifyError: null, verification: { status: "unreachable", message: "unreachable", checkedAt: "2026-11-25" } } })).toBe("save-warning");
});
