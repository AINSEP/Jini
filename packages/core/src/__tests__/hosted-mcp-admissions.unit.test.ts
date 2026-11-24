import assert from "node:assert/strict";
import { expectTypeOf, test } from "vitest";

import type { AdminExternalMcpAdmissionsSnapshot, AdminFederatedAdmissionEntry, AdminToolRefusalReason } from "../contracts/hosted-mcp.js";

/**
 * @file Pins the external-MCP admission wire shape this package owns (moved from the host admin).
 * The seven refusal reasons are the closed vocabulary an operator-facing drift banner switches over,
 * so adding or dropping one must fail `tsc` here, and a refused entry must carry exactly that union.
 */
type ExpectedReasons =
  | "not-in-operator-allowlist"
  | "remote-declares-destructive"
  | "remote-declares-not-read-only"
  | "missing-or-invalid-input-schema"
  | "invalid-remote-tool-name"
  | "duplicate-remote-tool-name"
  | "connection-tool-cap-reached";

test("AdminToolRefusalReason is exactly the seven admission-gate refusal reasons", () => {
  expectTypeOf<AdminToolRefusalReason>().toEqualTypeOf<ExpectedReasons>();
  const reasons = {
    "not-in-operator-allowlist": 1,
    "remote-declares-destructive": 1,
    "remote-declares-not-read-only": 1,
    "missing-or-invalid-input-schema": 1,
    "invalid-remote-tool-name": 1,
    "duplicate-remote-tool-name": 1,
    "connection-tool-cap-reached": 1,
  } satisfies Record<AdminToolRefusalReason, 1>;
  assert.equal(Object.keys(reasons).length, 7);
});

test("a refused admission entry's reason is AdminToolRefusalReason", () => {
  expectTypeOf<AdminFederatedAdmissionEntry["refused"][number]["reason"]>().toEqualTypeOf<AdminToolRefusalReason>();
  expectTypeOf<NonNullable<AdminExternalMcpAdmissionsSnapshot["configFailures"]>[number]["reason"]>().toEqualTypeOf<string>();
});
