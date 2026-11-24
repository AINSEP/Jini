// Ported from the host app's find-menu test with the module; the host keeps its copy as the consumer check.
import assert from "node:assert/strict";
import { test } from "vitest";

import { nativeFindMenu, sendNativeFindToggle } from "../find-menu.js";

const CHANNEL = "host:find:toggle";
const LABELS = { menu: "Find", item: "Find in Page…" };

/** A BrowserWindow stand-in that records what was sent to its renderer, positionally. */
function fakeWindow({ destroyed = false }: { destroyed?: boolean } = {}) {
  const sent: string[] = [];
  return { sent, isDestroyed: () => destroyed, webContents: { send: (channel: string) => sent.push(channel) } };
}

test("the menu carries the host's labels and one item on CmdOrCtrl+F by default", () => {
  const menu = nativeFindMenu({ channel: CHANNEL, labels: LABELS });
  assert.equal(menu.label, "Find");
  assert.deepEqual(menu.submenu.map(({ label, accelerator }) => [label, accelerator]), [["Find in Page…", "CmdOrCtrl+F"]]);
  assert.equal(nativeFindMenu({ channel: CHANNEL, labels: LABELS }, { accelerator: "F3" }).submenu[0].accelerator, "F3");
});

test("clicking the item sends the injected channel positionally to the focused native window", () => {
  const [item] = nativeFindMenu({ channel: CHANNEL, labels: LABELS }).submenu;
  const window = fakeWindow();
  item.click(undefined, window);
  assert.deepEqual(window.sent, [CHANNEL]);
  assert.doesNotThrow(() => item.click(undefined, undefined));
});

test("with no focused window, a destroyed one, or one without webContents, nothing is sent", () => {
  assert.equal(sendNativeFindToggle({ window: undefined, channel: CHANNEL }), false);
  const destroyed = fakeWindow({ destroyed: true });
  assert.equal(sendNativeFindToggle({ window: destroyed, channel: CHANNEL }), false);
  assert.deepEqual(destroyed.sent, []);
  assert.equal(sendNativeFindToggle({ window: { isDestroyed: () => false }, channel: CHANNEL }), false);
  const live = fakeWindow();
  assert.equal(sendNativeFindToggle({ window: live, channel: CHANNEL }), true);
  assert.deepEqual(live.sent, [CHANNEL]);
});
