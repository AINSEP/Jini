import { describe, expect, it } from "vitest";

import { menusAgentToolCatalog } from "../agent-tools.js";

const MENU_DELETE_HINT = "To delete a menu, use trash_item with entityType 'menu' (it moves to the Trash and can be restored).";
const HINTED_TOOLS = ["menus_list_menus", "menus_create_menu", "menus_update_menu_tree"];

describe("menu catalog points deletion requests to the reversible Trash tool", () => {
  for (const name of HINTED_TOOLS) {
    it(`${name} ends with the exact menu-delete hint`, () => {
      const tool = menusAgentToolCatalog.find((entry) => entry.name === name);
      expect(tool, `${name} must exist`).toBeDefined();
      expect(tool!.description.endsWith(MENU_DELETE_HINT)).toBe(true);
    });
  }

  it("the menu-delete hint appears on exactly the three named menu tools", () => {
    expect(menusAgentToolCatalog.filter((tool) => tool.description.includes(MENU_DELETE_HINT)).map((tool) => tool.name).sort())
      .toEqual([...HINTED_TOOLS].sort());
  });
});
