import assert from "node:assert/strict";
import { test } from "vitest";

import type { ToolMetadata } from "../tool-metadata-types.js";
import type { ToolApprovalClass, ToolApprovalPolicy } from "../contracts/site/tool-metadata-approval-policy.js";

/**
 * @file Type fixture for the host-specialized approval policy. The guarantees here are compile-time:
 * `pnpm typecheck` compiles this file, so a host that narrows `Rule` to its own rule names must be
 * able to assign one of them, and must be refused anything outside that union. The runtime asserts
 * only keep vitest honest about the values the fixtures build.
 */

type HostRule = "http-method" | "page-control";

const named: ToolApprovalPolicy<HostRule> = { class: "edit", confirmation: "policy", rule: "http-method" };
const unruled: ToolApprovalPolicy = { class: "read", confirmation: "direct" };
const outsideUnion: ToolApprovalPolicy<HostRule> = {
  class: "delete",
  confirmation: "policy",
  // @ts-expect-error a host-specialized policy refuses a rule name outside its own union.
  rule: "theme-activation",
};
const deleteClass: ToolApprovalClass = "delete";
// @ts-expect-error the class union is core's ToolApprovalMetadata["class"]; an unknown class is refused.
const unknownClass: ToolApprovalClass = "archive";
// A specialized policy must still fit core's ToolMetadata<A> slot (it extends ToolApprovalMetadata).
const metadata: ToolMetadata<ToolApprovalPolicy<HostRule>> = { title: "Save", approval: named };

test("a host-specialized ToolApprovalPolicy carries its named rule", () => {
  assert.equal(named.rule, "http-method");
  assert.equal(metadata.approval?.rule, "http-method");
});

test("rule stays optional and class reuses core's approval classes", () => {
  assert.equal(unruled.rule, undefined);
  assert.equal(deleteClass, "delete");
  assert.equal(unknownClass, "archive");
  assert.equal(outsideUnion.rule, "theme-activation");
});
