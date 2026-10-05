import { expect, test } from "vitest";

import { listPermissions, principalKindMayExercisePermission, type PrincipalKind } from "../index.js";

/**
 * @file The principal-kind bar (OWNER DECISION 2026-10-04, Tovu F3144): a site `member` may not
 * exercise any operator permission; every other kind is not barred (its grants still decide).
 */

const permissions = [...listPermissions({}).map((descriptor) => descriptor.id), "*"];

test("a member is barred from every catalog permission and the owner wildcard", () => {
  expect(permissions.length).toBeGreaterThan(10);
  for (const permission of permissions) {
    expect(principalKindMayExercisePermission({ kind: "member", permission }), permission).toBe(false);
  }
});

test("operator kinds are not barred by kind", () => {
  const operatorKinds: PrincipalKind[] = ["user", "agent", "api_key", "system"];
  for (const kind of operatorKinds) {
    for (const permission of permissions) {
      expect(principalKindMayExercisePermission({ kind, permission }), `${kind} ${permission}`).toBe(true);
    }
  }
});
