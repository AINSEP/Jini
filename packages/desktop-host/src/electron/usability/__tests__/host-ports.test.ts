import { test } from "vitest";
import assert from "node:assert/strict";
import { findMenu, zoomMenuItems, registerFindInPageIpc, relayFindResults, readWindowBounds, writeWindowBounds, resolveWindowBounds, restoreWindowBounds, buildSpellCheckMenuTemplate } from "../index.js";

test("two hosts keep menu labels, channels and persistence keys independent", () => {
  const a: string[] = [], b: string[] = [];
  const windowA = { isDestroyed: () => false, webContents: { send: ({ channel }: { channel: string }) => a.push(channel) } };
  const windowB = { isDestroyed: () => false, webContents: { send: ({ channel }: { channel: string }) => b.push(channel) } };
  const menuA = findMenu({ channel: "a:find", labels: { menu: "Search A", item: "Search this page" } });
  const menuB = findMenu({ channel: "b:find", labels: { menu: "Search B", item: "Look here" } });
  menuA.submenu[0].click({ window: windowA }); menuB.submenu[0].click({ window: windowB });
  assert.equal(menuA.label, "Search A"); assert.equal(menuB.label, "Search B");
  assert.deepEqual(a, ["a:find"]); assert.deepEqual(b, ["b:find"]);
  const zoom = zoomMenuItems({ channel: "b:zoom", labels: { reset: "Original", in: "Larger", out: "Smaller" } });
  assert.deepEqual(zoom.map(i => i.label), ["Original", "Larger", "Larger", "Smaller"]);
  const records = new Map<string, unknown>();
  const store = { read: ({ key }: { key: string }) => records.get(key), write: ({ key, bounds }: { key: string; bounds: import("../index.js").WindowBounds }) => { records.set(key, bounds); } };
  const bounds = { x: 1, y: 2, width: 800, height: 600 };
  writeWindowBounds({ store, key: "a:bounds", bounds });
  assert.deepEqual(readWindowBounds({ store, key: "a:bounds" }), bounds);
  assert.equal(readWindowBounds({ store, key: "b:bounds" }), null);
});

test("IPC and result disposers remove only their registered channels and listeners", () => {
  const removed: string[] = [];
  const dispose = registerFindInPageIpc({ ipcMain: { handle: () => {}, removeHandler: ({ channel }) => removed.push(channel) }, browserWindow: { fromWebContents: () => null }, channels: { find: "a:query", stop: "a:stop" } });
  dispose(); assert.deepEqual(removed, ["a:query", "a:stop"]);
  let registered: unknown, detached: unknown;
  const relayDispose = relayFindResults({ window: { isDestroyed: () => false, webContents: { on: ({ listener }) => { registered = listener; }, removeListener: ({ listener }) => { detached = listener; }, send: () => {} } }, resultChannel: "a:result" });
  relayDispose(); assert.equal(detached, registered);
});

test("broken persistence falls back to centered geometry", () => {
  const store = { read: () => { throw new Error("storage disabled"); }, write: () => {} };
  const stored = readWindowBounds({ store, key: "caller-key" });
  assert.deepEqual(resolveWindowBounds({ stored, displays: [], fallback: { width: 900, height: 700 } }), { width: 900, height: 700 });
});

test("spelling labels and suggestion limits belong to the host", () => {
  const menu = buildSpellCheckMenuTemplate({ params: { isEditable: false, misspelledWord: "word", dictionarySuggestions: [], editFlags: { canCut: false, canCopy: false, canPaste: false, canSelectAll: false } }, handlers: { replace: () => {}, addToDictionary: () => {}, cut: () => {}, copy: () => {}, paste: () => {}, selectAll: () => {} }, labels: { noSuggestions: "No alternatives", addToDictionary: "Remember word", cut: "Remove", copy: "Duplicate", paste: "Insert", selectAll: "Everything" } });
  assert.deepEqual(menu.map(i => i.label ?? i.type), ["No alternatives", "separator", "Remember word"]);
});

test("restoration reads the configured key and current displays through ports", () => {
  const reads: string[] = [];
  let displayReads = 0;
  const stored = { x: -1200, y: 20, width: 1000, height: 600 };
  const store = { read: ({ key }: { key: string }) => { reads.push(key); return stored; }, write: () => {} };
  const display = { getAllDisplays: () => { displayReads++; return [{ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }]; } };
  assert.deepEqual(restoreWindowBounds({ store, display, key: "window:a", fallback: { width: 800, height: 600 } }), { width: 800, height: 600 });
  assert.deepEqual(reads, ["window:a"]); assert.equal(displayReads, 1);
});
