import { expect, it, vi } from "vitest";
import { createSiteSharePasswordHandler, savedKeysSameOrigin, sendSiteShareFailure, savedShareRefusalStatus, savedShareUploadRefusal } from "../site-share-password.js";

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

function passwordFacts() {
  const json = vi.fn();
  return {
    json, failure: vi.fn(), principalId: () => "owner-7", shareId: () => "share-9",
    owner: {
      json, noStore: vi.fn(), foreignWorkspace: () => false, requireSession: () => true,
      publishTrustContext: () => undefined, principalId: () => "owner-7",
      ownerPrincipalId: async () => "owner-7", sameOrigin: () => true, ownerMessage: "Owner browser required.",
    },
  };
}

it("replies with a saved password only for the requested share and keeps the answer out of caches", async () => {
  const facts = passwordFacts();
  const revealPassword = vi.fn(async ({ principalId, shareId }: { principalId: string; shareId: string }) => {
    if (principalId !== "owner-7" || shareId !== "share-9") throw new Error("unexpected lookup");
    return { password: "fixture-passphrase" };
  });
  await createSiteSharePasswordHandler({ readBackend: () => ({ revealPassword }) })(facts);
  expect(revealPassword.mock.calls).toEqual([[{ principalId: "owner-7", shareId: "share-9" }]]);
  expect(facts.owner.noStore).toHaveBeenCalledTimes(1);
  expect(facts.json.mock.calls).toEqual([[{ password: "fixture-passphrase" }, 200]]);
  expect(facts.failure.mock.calls).toEqual([]);
});

it("routes backend exceptions through the password-safe failure path without writing a JSON reply", async () => {
  const facts = passwordFacts();
  const outage = new Error("private store details");
  await createSiteSharePasswordHandler({ readBackend: () => ({ revealPassword: async () => { throw outage; } }) })(facts);
  expect(facts.failure.mock.calls).toEqual([[outage, { password: true }]]);
  expect(facts.json.mock.calls).toEqual([]);
});

it("reports saved keys unavailable when there is no backend for the admitted owner", async () => {
  const facts = passwordFacts();
  await createSiteSharePasswordHandler({ readBackend: () => undefined })(facts);
  expect(facts.json.mock.calls).toEqual([[{ code: "UNAVAILABLE", message: "Export password lookup failed: saved keys are unavailable." }, 503]]);
  expect(facts.failure.mock.calls).toEqual([]);
});

it("maps a rejected upload parser to the public ZIP-size refusal", () => {
  class Refusal extends Error { code = "INVALID_INPUT"; }
  class ExportFailure extends Error { step = "archive" as const; }
  const json = vi.fn();
  const failure = vi.fn();
  sendSiteShareFailure({ error: { type: "entity.too.large" }, deps: { json, failure, refusal: Refusal, exportFailure: ExportFailure } }, { step: "ZIP upload" });
  expect(json.mock.calls).toEqual([[{ code: "LIMIT_EXCEEDED", message: "ZIP upload failed: upload raw application/zip bytes within the 300 MiB cap." }, 413]]);
  expect(failure.mock.calls).toEqual([]);
});
