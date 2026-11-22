import assert from "node:assert/strict";
import { test } from "vitest";

import { MENU_RAW_HTML_PERMISSION } from "../menu-html-permission.js";

/**
 * @file Pins the menu raw-HTML permission, written before the verbatim move: menus share the one
 * raw-HTML trust boundary with Pages and Forms, so the key must stay `pages.edit_html`.
 */

test("menu HTML mode needs the shared raw-HTML permission", () => {
  assert.equal(MENU_RAW_HTML_PERMISSION, "pages.edit_html");
});
