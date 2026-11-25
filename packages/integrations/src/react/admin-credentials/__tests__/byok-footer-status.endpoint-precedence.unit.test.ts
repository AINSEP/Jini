import { expect, test } from "vitest";
import { resolveByokFooterStatusLine } from "../byok-footer-status.js";

const copy = { saving: "Saving", saved: "Saved", otherEndpoint: "Enter this endpoint's key", stored: "Stored", enterKey: "Enter key" };

test("endpoint mismatch beats a stored key only while idle", () => {
  expect(resolveByokFooterStatusLine({ status: "idle", isStored: true, copy }, { storedKeyIsForOtherEndpoint: true })).toBe(copy.otherEndpoint);
  expect(resolveByokFooterStatusLine({ status: "saving", isStored: true, copy }, { storedKeyIsForOtherEndpoint: true })).toBe(copy.saving);
  expect(resolveByokFooterStatusLine({ status: "saved", isStored: true, copy }, { storedKeyIsForOtherEndpoint: true })).toBe(copy.saved);
  expect(resolveByokFooterStatusLine({ status: "error", isStored: true, copy }, { storedKeyIsForOtherEndpoint: true })).toBeNull();
  expect(resolveByokFooterStatusLine({ status: "idle", isStored: true, copy }, {})).toBe(copy.stored);
  expect(resolveByokFooterStatusLine({ status: "idle", isStored: false, copy }, {})).toBe(copy.enterKey);
});
