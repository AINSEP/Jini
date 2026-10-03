import { findMenu as menu, sendFindToggle as send } from "../find-menu.js";
const FIND_TOGGLE_CHANNEL = "sample:find:toggle";
const findMenu = () => menu({ channel: FIND_TOGGLE_CHANNEL, labels: { menu: "Find", item: "Find in Page…" } });
const sendFindToggle = (window: Parameters<typeof send>[0]["window"]) => send({ window, channel: FIND_TOGGLE_CHANNEL });
/** Characterization of find-menu: copied menu behavior with caller-owned configuration. */
import { test } from "vitest";
import assert from "node:assert/strict";



/** A BrowserWindow stand-in that records what was sent to its renderer. */
function fakeWindow({ destroyed = false }: { destroyed?: boolean } = {}) {
  const sent: string[] = [];
  return {
    sent,
    isDestroyed: () => destroyed,
    webContents: { send: ({ channel }: { channel: string }) => sent.push(channel) },
  };
}

test("Find has one item, Find in Page… on CmdOrCtrl+F", () => {
  const menu = findMenu();
  assert.equal(menu.label, "Find");
  assert.deepEqual(
    menu.submenu.map(({ label, accelerator }) => [label, accelerator]),
    [["Find in Page…", "CmdOrCtrl+F"]],
  );
});

test("clicking Find in Page… sends the toggle to the focused window's renderer", () => {
  const [findItem] = findMenu().submenu;
  const window = fakeWindow();
  findItem.click({ window });
  assert.deepEqual(window.sent, [FIND_TOGGLE_CHANNEL]);
});

test("with no focused window, a destroyed one, or one without webContents, nothing is sent", () => {
  assert.equal(sendFindToggle(undefined), false);
  const destroyed = fakeWindow({ destroyed: true });
  assert.equal(sendFindToggle(destroyed), false);
  assert.deepEqual(destroyed.sent, []);
  assert.equal(sendFindToggle({ isDestroyed: () => false }), false);
  assert.equal(sendFindToggle(fakeWindow()), true);
});

