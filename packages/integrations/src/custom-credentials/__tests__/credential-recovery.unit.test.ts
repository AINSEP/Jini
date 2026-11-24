import { expect, it } from "vitest";
import type { ToolFailureDiagnostic } from "@jini-ai/core/contracts/site/daemon-tool-recovery";
import { CustomCredentialNotFoundError } from "../../credentialed-http/sets/store.js";
import { withCustomCredentialSetup, type IssueCredentialSetup } from "../credential-recovery.js";

/** @file A failing credentialed call offers the credential_save card it can actually use, and keeps provider output. */

/** A stand-in for the host's issuer: records what it was asked to issue. */
const issueCredentialSetup: IssueCredentialSetup = ({ setupToolId, prefill }) => ({ setupToolId, prefill } as unknown as ToolFailureDiagnostic);
const setupFor = (prefill: Record<string, string>) => issueCredentialSetup({ setupToolId: "credential_save", prefill }, {});
const missing = async (): Promise<never> => { throw new CustomCredentialNotFoundError("missing"); };

it("returns a successful call's output untouched", async () => {
  const output = { status: 200, body: "ok" };
  expect(await withCustomCredentialSetup({ invoke: async () => output, label: "Stripe", issueCredentialSetup })).toBe(output);
});

it("turns a missing credential into a setup card prefilled with the label and the URL's origin", async () => {
  const result = await withCustomCredentialSetup({ invoke: missing, label: "Stripe", url: "https://api.stripe.com/v1/charges?limit=1", issueCredentialSetup });
  expect(result).toEqual({ executed: false, credentialSetup: setupFor({ kind: "api", label: "Stripe", baseUrl: "https://api.stripe.com" }) });
});

it("omits the base URL prefill with no URL or an unparseable URL", async () => {
  const expected = { executed: false, credentialSetup: setupFor({ kind: "api", label: "Stripe" }) };
  expect(await withCustomCredentialSetup({ invoke: missing, label: "Stripe", issueCredentialSetup })).toEqual(expected);
  expect(await withCustomCredentialSetup({ invoke: missing, label: "Stripe", url: "not a url", issueCredentialSetup })).toEqual(expected);
});

it("propagates any other failure unchanged", async () => {
  const failure = new Error("network down");
  await expect(withCustomCredentialSetup({ invoke: async () => { throw failure; }, label: "Stripe", issueCredentialSetup })).rejects.toBe(failure);
});

it("offers replacement only when explicit verification reports invalid", async () => {
  for (const status of [401, 403, "refused"]) {
    const output = { status, body: "refused for this purpose" };
    expect(await withCustomCredentialSetup({ invoke: async () => output, label: "Sending key", verification: true, issueCredentialSetup })).toBe(output);
  }
  const invalid = { status: "invalid" };
  expect(await withCustomCredentialSetup({ invoke: async () => invalid, label: "Sending key", issueCredentialSetup })).toBe(invalid);
  expect(await withCustomCredentialSetup({ invoke: async () => invalid, label: "Sending key", verification: true, issueCredentialSetup }))
    .toEqual({ credentialSetup: setupFor({ kind: "api", target: "Sending key" }), status: "invalid" });
});
