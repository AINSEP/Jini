import { describe, expect, it } from "vitest";

import { identityAgentToolCatalog } from "../agent-tools.js";

const PASSWORD_RESET_HINT = "There is no password-reset tool. The owner resets a user's password from the Users screen in the admin (Reset password).";
const ROLE_UNASSIGN_HINT = "There is no tool to remove a role from a user, and no unassign operation exists anywhere in this system yet; tell the owner rather than trying another tool.";

describe("identity catalog honesty for deliberate gaps", () => {
  for (const name of ["identity_user_update_email", "identity_user_list"]) {
    it(`${name} ends with the exact password-reset guidance`, () => {
      const tool = identityAgentToolCatalog.find((entry) => entry.name === name);
      expect(tool, `${name} must exist`).toBeDefined();
      expect(tool!.description.endsWith(PASSWORD_RESET_HINT)).toBe(true);
    });
  }

  it("password-reset guidance appears on exactly the two user tools", () => {
    expect(identityAgentToolCatalog.filter((tool) => tool.description.includes(PASSWORD_RESET_HINT)).map((tool) => tool.name).sort())
      .toEqual(["identity_user_list", "identity_user_update_email"]);
  });

  it("identity_role_assign ends with the exact role-unassign refusal", () => {
    const tool = identityAgentToolCatalog.find((entry) => entry.name === "identity_role_assign");
    expect(tool, "identity_role_assign must exist").toBeDefined();
    expect(tool!.description.endsWith(ROLE_UNASSIGN_HINT)).toBe(true);
  });

  it("role-unassign guidance appears on exactly identity_role_assign", () => {
    expect(identityAgentToolCatalog.filter((tool) => tool.description.includes(ROLE_UNASSIGN_HINT)).map((tool) => tool.name))
      .toEqual(["identity_role_assign"]);
  });
});
