import { expectTypeOf, test } from "vitest";

import type { CredentialSetSummary } from "../../credentials.js";
import type { PublishCompatibilityPort } from "../custom-credential-publish-compatibility.js";

test("prepareInvalidation preserves both arguments and the post-write callback", () => {
  expectTypeOf<Parameters<PublishCompatibilityPort["prepareInvalidation"]>>().toEqualTypeOf<[
    required: { workspaceId: string },
    optional?: Record<string, never>,
  ]>();
  expectTypeOf<Awaited<ReturnType<PublishCompatibilityPort["prepareInvalidation"]>>>().toEqualTypeOf<
    (required: { after: CredentialSetSummary }) => void
  >();
});
