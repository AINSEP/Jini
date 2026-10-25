import { expect, it } from "vitest";
import { identityAgentToolCatalog } from "../agent-tools.js";

// F1 fix wave (Stryker L1 §4 agent-tools.ts: every `required: [...]` → `[]` survived; AP5). An
// INLINE contract per tool — name, gating permission(s), required args, closed schema, and the
// exact property set — so loosening any one is a failing diff here, not a regenerated snapshot.
const U = { permission: "user.manage" };
const UM = { permission: "user.manage", orPermission: "member.manage" };
const R = { permission: "role.manage" };
const EXPECTED: [string, Record<string, string>, string[], string[]][] = [
  ["identity_user_list", UM, [], []],
  ["identity_role_list", R, [], []],
  ["identity_policy_list", R, [], []],
  ["identity_user_create", U, ["username", "password"], ["username", "password", "email"]],
  ["identity_user_update_email", UM, ["principalId"], ["principalId", "email"]],
  ["identity_user_change_username", U, ["principalId", "username"], ["principalId", "username"]],
  ["identity_user_disable", U, ["principalId"], ["principalId"]],
  ["identity_user_enable", U, ["principalId"], ["principalId"]],
  ["identity_role_create", R, ["name"], ["name"]],
  ["identity_role_assign", R, ["principalId", "roleId"], ["principalId", "roleId"]],
  ["identity_role_rename", R, ["roleId", "name"], ["roleId", "name"]],
  ["identity_role_delete", R, ["roleId"], ["roleId"]],
  ["identity_policy_create", R, ["name"], ["name", "description"]],
  ["identity_policy_update", R, ["policyId"], ["policyId", "name", "description"]],
  ["identity_policy_delete", R, ["policyId"], ["policyId"]],
  ["identity_policy_attach", R, ["principalId", "policyId"], ["principalId", "policyId"]],
];

it("F1: the identity agent-tool catalog matches its inline contract exactly (order included)", () => {
  const actual = identityAgentToolCatalog.map((tool) => {
    const schema = tool.inputSchema as { type: string; additionalProperties: boolean; required: string[]; properties: Record<string, unknown> };
    expect(schema.type, tool.name).toBe("object");
    expect(schema.additionalProperties, tool.name).toBe(false);
    return [tool.name, tool.authorization, schema.required, Object.keys(schema.properties)];
  });
  expect(actual).toEqual(EXPECTED);
});

it("F1: every required arg is a declared property, and every id/name property refuses the empty string", () => {
  for (const tool of identityAgentToolCatalog) {
    const schema = tool.inputSchema as { required: string[]; properties: Record<string, { type?: string; minLength?: number }> };
    for (const key of schema.required) expect(Object.keys(schema.properties), `${tool.name}.${key}`).toContain(key);
    for (const [key, prop] of Object.entries(schema.properties)) {
      if (/Id$|^name$|^username$/.test(key)) expect(prop.minLength, `${tool.name}.${key}`).toBe(1);
    }
  }
});
