import { describe, expect, expectTypeOf, it } from "vitest";
import type { ISODateTime, UUID } from "@jini-ai/core/primitives";
import type { CredentialTokenHint } from "@jini-ai/core/contracts/site/secrets-credential-token";
import type { DeployTargetDescriptor } from "../../../target-contracts.js";
import type {
  PublishConnectionInput,
  PublishCredentialScope,
  PublishCredentialSummary,
  PublishProviderId,
} from "../types.js";

/**
 * The module is types only, so this file pins the contract at compile time (`tsc` is the red/green
 * signal for the `expectTypeOf` lines) and keeps one runtime fixture that must satisfy the summary
 * shape, so a dropped or renamed field fails the package typecheck as well as review.
 */
describe("publish credential domain types", () => {
  it("takes the provider id from the deploy target descriptor", () => {
    expectTypeOf<PublishProviderId>().toEqualTypeOf<DeployTargetDescriptor["id"]>();
  });

  it("keeps a connection as the provider id plus flat string fields", () => {
    const connection = { providerId: "any-host", token: "t", owner: "o" } satisfies PublishConnectionInput;

    expectTypeOf<PublishConnectionInput>().toMatchTypeOf<{ readonly providerId: PublishProviderId }>();
    expectTypeOf<PublishConnectionInput[string]>().toEqualTypeOf<string>();
    expect(connection.providerId).toBe("any-host");
  });

  it("describes a summary that carries no secret field and a clear-text account label", () => {
    const scope: PublishCredentialScope = "project";
    const summary = {
      credentialType: "vendor",
      worksFor: ["a"],
      publishHosts: ["a"],
      defaultFor: [],
      id: "00000000-0000-4000-8000-000000000000" as UUID,
      providerId: "any-host",
      vendorId: "vendor",
      label: "label",
      configured: true,
      isDefault: false,
      tokenTail: "abcd",
      accountLabel: null,
      scope,
      createdAt: "2026-01-01T00:00:00.000Z" as ISODateTime,
      updatedAt: "2026-01-01T00:00:00.000Z" as ISODateTime,
    } satisfies PublishCredentialSummary;

    expectTypeOf<PublishCredentialSummary["tokenHint"]>().toEqualTypeOf<CredentialTokenHint | null | undefined>();
    expectTypeOf<PublishCredentialSummary["accountLabel"]>().toEqualTypeOf<string | null>();
    expectTypeOf<PublishCredentialSummary["configured"]>().toEqualTypeOf<true>();
    expectTypeOf<"sealed" | "token">().not.toMatchTypeOf<keyof PublishCredentialSummary>();
    expect(summary.accountLabel).toBeNull();
  });
});
