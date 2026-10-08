import assert from "node:assert/strict";
import { test } from "vitest";

import { deriveRequiredPermission } from "../write-service.js";

test("deriveRequiredPermission returns settings.global.write for scope=global", () => {
  assert.equal(
    deriveRequiredPermission({ scope: "global", callerPrincipalId: "actor-1" }),
    "settings.global.write"
  );
});

test("deriveRequiredPermission returns settings.workspace.write for scope=workspace", () => {
  assert.equal(
    deriveRequiredPermission({ scope: "workspace", callerPrincipalId: "actor-1" }),
    "settings.workspace.write"
  );
});

test("deriveRequiredPermission returns settings.user.self.write when principalId is omitted (AC-26)", () => {
  assert.equal(
    deriveRequiredPermission({ scope: "user", callerPrincipalId: "actor-1" }),
    "settings.user.self.write"
  );
});

test("deriveRequiredPermission returns settings.user.self.write when principalId equals the caller (AC-26)", () => {
  assert.equal(
    deriveRequiredPermission({ scope: "user", targetPrincipalId: "actor-1", callerPrincipalId: "actor-1" }),
    "settings.user.self.write"
  );
});

test("deriveRequiredPermission returns settings.user.write when principalId differs from the caller (AC-25)", () => {
  assert.equal(
    deriveRequiredPermission({ scope: "user", targetPrincipalId: "actor-2", callerPrincipalId: "actor-1" }),
    "settings.user.write"
  );
});
