import type { JsonRouteSpec } from "@jini-ai/core/contracts/server";
import type {
  ExternalMcpAdmissionsEnvelope, ExternalMcpDeleteEnvelope, ExternalMcpListEnvelope, ExternalMcpOAuthDisconnectEnvelope, ExternalMcpPutEnvelope,
  ExternalMcpToolApprovalDto, ExternalMcpToolApprovalRevokeEnvelope, ExternalMcpToolApprovalsEnvelope,
} from "@jini-ai/core/contracts/site/cms-external-mcp";
import { describe, expect, it } from "vitest";

import { externalMcpAdmissionsRoute } from "../admissions.js";
import { externalMcpDeleteRoute } from "../delete.js";
import { externalMcpListRoute } from "../list.js";
import { externalMcpOAuthDisconnectRoute } from "../oauth-disconnect.js";
import { externalMcpPutRoute } from "../put.js";
import { externalMcpParam, invalidServerMapping, rejectExternalMcpError, secretStoreMapping } from "../shared.js";
import { externalMcpToolApprovalRevokeRoute, externalMcpToolApprovalsListRoute, type ExternalMcpToolApprovalRow } from "../tool-approvals.js";
import { FakeSecretStoreError, FakeValidationError, isSecretStoreUnconfiguredError, isValidationError, refusalOf } from "./helpers.js";

/**
 * @file rv1123e K1 migration: the external-MCP wire DTOs are declared once in neutral Core
 * (`@jini-ai/core/contracts/site/cms-external-mcp`); every route spec answers exactly those shapes,
 * and the family's helpers take object arguments with byte-identical output.
 */
/** Mutual assignability, checked by the compiler: `true` only when each side accepts the other. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
/** The body type a route spec answers with. */
type OutputOf<S> = S extends JsonRouteSpec<infer _I, infer O, infer _D, infer _C> ? O : never;

describe("external-mcp wire DTOs", () => {
  it("answers every route with its Core envelope", () => {
    // A spec that drifts from the Core declaration (or the reverse) fails `tsc` here.
    const parity: [
      Same<OutputOf<typeof externalMcpListRoute>, ExternalMcpListEnvelope>, Same<OutputOf<typeof externalMcpPutRoute>, ExternalMcpPutEnvelope>,
      Same<OutputOf<typeof externalMcpDeleteRoute>, ExternalMcpDeleteEnvelope>, Same<OutputOf<typeof externalMcpAdmissionsRoute>, ExternalMcpAdmissionsEnvelope>,
      Same<OutputOf<typeof externalMcpToolApprovalsListRoute>, ExternalMcpToolApprovalsEnvelope>,
      Same<OutputOf<typeof externalMcpToolApprovalRevokeRoute>, ExternalMcpToolApprovalRevokeEnvelope>,
      Same<OutputOf<typeof externalMcpOAuthDisconnectRoute>, ExternalMcpOAuthDisconnectEnvelope>,
      // The store row carries every field the list sends (the DTO is the row minus what is never sent).
      Same<Pick<ExternalMcpToolApprovalRow, keyof ExternalMcpToolApprovalDto>, ExternalMcpToolApprovalDto>,
    ] = [true, true, true, true, true, true, true, true];
    expect(parity).toEqual([true, true, true, true, true, true, true, true]);
  });

  it("reads params and maps errors through object arguments with the hand-written bodies", async () => {
    expect(externalMcpParam({ params: {}, name: "serverId" })).toBe("");
    expect(externalMcpParam({ params: { serverId: "s1" }, name: "serverId" })).toBe("s1");
    const mappings = [invalidServerMapping({ isValidationError }), secretStoreMapping({ isSecretStoreUnconfiguredError })];
    expect(await refusalOf(() => rejectExternalMcpError({ err: new FakeValidationError("bad", "command"), mappings }))).toEqual({
      status: 400, body: { error: "bad", code: "INVALID_MCP_SERVER", details: { field: "command" } },
    });
    expect(await refusalOf(() => rejectExternalMcpError({ err: new FakeSecretStoreError("no key"), mappings }))).toEqual({
      status: 503, body: { error: "no key", code: "SECRET_STORE_UNCONFIGURED" },
    });
    const unmapped = new Error("boom");
    expect(() => rejectExternalMcpError({ err: unmapped, mappings })).toThrow(unmapped);
  });
});
