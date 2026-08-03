import assert from "node:assert/strict";
import { test } from "vitest";

import { isKnownPermission, listPermissions, registerPermission } from "../permissions.js";

/**
 * @file The registered permission catalog (REQ-03/REQ-12).
 */

test("REQ-03: the base catalog includes the seed-time vocabulary (content/media/theme/plugin/changeset/member/user/role/settings/apikey)", () => {
  const ids = listPermissions().map((p) => p.id);
  for (const expected of [
    "content.read",
    "content.write",
    "content.publish",
    "content.delete",
    "media.write",
    "theme.set",
    "plugin.read",
    "plugin.enable",
    "plugin.disable",
    "changeset.read",
    "changeset.revert",
    "member.manage",
    "user.manage",
    "role.manage",
    "settings.write",
    "apikey.manage",
  ]) {
    assert.ok(ids.includes(expected), `catalog is missing '${expected}'`);
  }
});

test("REQ-03: isKnownPermission is true for a catalog entry and false for an unregistered string", () => {
  assert.equal(isKnownPermission("content.write"), true);
  assert.equal(isKnownPermission("not-a-real-permission"), false);
});

test("the owner wildcard '*' is deliberately excluded from the registrable catalog", () => {
  assert.equal(isKnownPermission("*"), false);
});

test("FEAT-014/ADR-PIPE-014: analytics.read is registered (analytics recent-hits authz gate)", () => {
  assert.equal(isKnownPermission("analytics.read"), true);
});

test("REQ-03: a feature can register an additional permission at startup, idempotently", () => {
  registerPermission({ id: "billing.write", owner: "billing-plugin", description: "Manage billing." });
  assert.equal(isKnownPermission("billing.write"), true);

  // Re-registering the same id is an idempotent overwrite, not a duplicate entry.
  registerPermission({ id: "billing.write", owner: "billing-plugin", description: "Manage billing (updated)." });
  const matches = listPermissions().filter((p) => p.id === "billing.write");
  assert.equal(matches.length, 1);
  assert.equal(matches[0]!.description, "Manage billing (updated).");
});
