import { describe, expect, it } from "vitest";

import { menusAgentToolCatalog } from "../agent-tools.js";
import { MENU_REL_TOKENS } from "../link-rel.js";

// The published attrs text must state the stored rel policy (link-rel.ts), so a model knows an
// unknown token is dropped rather than saved and that new-tab links always get noopener noreferrer.
function attrsDescription(toolName: string): string {
  const tool = menusAgentToolCatalog.find((entry) => entry.name === toolName);
  const items = (tool?.inputSchema as { properties: { items: { $defs: { navItem: { properties: { attrs: { description: string } } } } } } }).properties.items;
  return items.$defs.navItem.properties.attrs.description;
}

describe("menu item attrs schema states the rel policy", () => {
  for (const name of ["menus_create_menu", "menus_update_menu_tree"]) {
    it(`${name} lists every allowed rel token, says others are dropped, and new tabs get noopener noreferrer`, () => {
      const text = attrsDescription(name);
      for (const token of MENU_REL_TOKENS) expect(text).toContain(token);
      expect(text).toMatch(/other tokens are dropped/i);
      expect(text).toMatch(/openInNewTab[^.]*noopener noreferrer/);
    });
  }
});
