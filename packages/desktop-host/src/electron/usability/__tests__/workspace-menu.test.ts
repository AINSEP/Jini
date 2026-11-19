import { test } from "vitest";
import assert from "node:assert/strict";
import { historyMenu, sendHistoryCommand, viewMenu, workspaceMenuTemplate } from "../index.js";

const channel = "host:history";
const labels = { menu: "Navigation", back: "Previous", forward: "Next" };
const zoomItems = [{ label: "Reset" }, { label: "Larger" }, { label: "Smaller" }];
const view = viewMenu({ label: "Display", zoomItems });
const history = historyMenu({ channel, labels });
const find = { label: "Search" };

/** A BrowserWindow stand-in that records what was sent to its renderer. */
function fakeWindow({ destroyed = false }: { destroyed?: boolean } = {}) {
  const sent: [string, string][] = [];
  return {
    sent,
    isDestroyed: () => destroyed,
    webContents: { send: (channel: string, payload: string) => sent.push([channel, payload]) },
  };
}

test("History has Back on CmdOrCtrl+[ and Forward on CmdOrCtrl+]", () => {
  const menu = historyMenu({ channel, labels });
  assert.equal(menu.label, labels.menu);
  assert.deepEqual(
    menu.submenu.map(({ label, accelerator }) => [label, accelerator]),
    [
      [labels.back, "CmdOrCtrl+["],
      [labels.forward, "CmdOrCtrl+]"],
    ],
  );
});

test("clicking Back and Forward sends the command to the focused window's renderer", () => {
  const [back, forward] = historyMenu({ channel, labels }).submenu;
  const window = fakeWindow();
  back.click(undefined, window);
  forward.click(undefined, window);
  assert.deepEqual(window.sent, [
    [channel, "back"],
    [channel, "forward"],
  ]);
});

test("with no focused window, a destroyed one, or one without webContents, nothing is sent", () => {
  assert.equal(sendHistoryCommand({ window: undefined, command: "back", channel }), false);
  const destroyed = fakeWindow({ destroyed: true });
  assert.equal(sendHistoryCommand({ window: destroyed, command: "back", channel }), false);
  assert.deepEqual(destroyed.sent, []);
  assert.equal(sendHistoryCommand({ window: { isDestroyed: () => false }, command: "forward", channel }), false);
  assert.equal(sendHistoryCommand({ window: fakeWindow(), command: "forward", channel }), true);
});

test("the workspace menu keeps Electron's default menus and adds History and Find before Window", () => {
  const roles = (template: { role?: string; label?: string }[]) => template.map((entry) => entry.role ?? entry.label);
  assert.deepEqual(roles(workspaceMenuTemplate({ platform: "darwin", view, history, find })), ["appMenu", "fileMenu", "editMenu", "Display", "Navigation", "Search", "windowMenu", "help"]);
  assert.deepEqual(roles(workspaceMenuTemplate({ platform: "linux", view, history, find })), ["fileMenu", "editMenu", "Display", "Navigation", "Search", "windowMenu", "help"]);
});

test("View preserves the supplied Zoom items between the default roles", () => {
  assert.equal(view.label, "Display");
  assert.deepEqual(view.submenu, [
    { role: "reload" },
    { role: "forceReload" },
    { role: "toggleDevTools" },
    { type: "separator" },
    ...zoomItems,
    { type: "separator" },
    { role: "togglefullscreen" },
  ]);
});
