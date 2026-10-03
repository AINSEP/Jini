import { zoomMenuItems as items, sendZoomCommand as send } from "../zoom-menu.js";
const ZOOM_COMMAND_CHANNEL = "sample:zoom:command";
const zoomMenuItems = () => items({ channel: ZOOM_COMMAND_CHANNEL, labels: { reset: "Actual Size", in: "Zoom In", out: "Zoom Out" } });
const sendZoomCommand = (window: Parameters<typeof send>[0]["window"], direction: Parameters<typeof send>[0]["direction"]) => send({ window, direction, channel: ZOOM_COMMAND_CHANNEL });
/** Characterization of zoom-menu: copied menu behavior with caller-owned configuration. */
import { test } from "vitest";
import assert from "node:assert/strict";



/** A BrowserWindow stand-in that records what was sent to its renderer. */
function fakeWindow({ destroyed = false }: { destroyed?: boolean } = {}) {
  const sent: Array<[string, unknown]> = [];
  return {
    sent,
    isDestroyed: () => destroyed,
    webContents: { send: ({ channel, direction }: { channel: string; direction: unknown }) => sent.push([channel, direction]) },
  };
}

test("four items: Actual Size, Zoom In, a hidden Zoom In alias, Zoom Out", () => {
  const items = zoomMenuItems();
  assert.deepEqual(
    items.map(({ label, accelerator, visible }) => [label, accelerator, visible]),
    [
      ["Actual Size", "CmdOrCtrl+0", undefined],
      ["Zoom In", "CmdOrCtrl+Plus", undefined],
      ["Zoom In", "CmdOrCtrl+=", false],
      ["Zoom Out", "CmdOrCtrl+-", undefined],
    ],
  );
});

test("each item sends its own direction to the focused window's renderer", () => {
  const items = zoomMenuItems();
  const window = fakeWindow();
  for (const item of items) item.click({ window });
  assert.deepEqual(window.sent, [
    [ZOOM_COMMAND_CHANNEL, "reset"],
    [ZOOM_COMMAND_CHANNEL, "in"],
    [ZOOM_COMMAND_CHANNEL, "in"],
    [ZOOM_COMMAND_CHANNEL, "out"],
  ]);
});

test("with no focused window, a destroyed one, or one without webContents, nothing is sent", () => {
  assert.equal(sendZoomCommand(undefined, "in"), false);
  const destroyed = fakeWindow({ destroyed: true });
  assert.equal(sendZoomCommand(destroyed, "in"), false);
  assert.deepEqual(destroyed.sent, []);
  assert.equal(sendZoomCommand({ isDestroyed: () => false }, "in"), false);
  assert.equal(sendZoomCommand(fakeWindow(), "in"), true);
});

