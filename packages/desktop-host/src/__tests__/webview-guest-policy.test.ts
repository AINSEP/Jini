
import { test } from "vitest";

import assert from "node:assert/strict";


import { admitGuestSource, applyGuestWebPreferences } from "../electron/navigation-policy/index.js";

import type { GuestWebPreferences } from "../electron/navigation-policy/index.js";


const PRELOAD = "/abs/path/to/preload-speech.cjs";


test("the guest is given the shell's preload, so window.sampleVoice exists in an embedded tab", () => {



  const webPreferences: GuestWebPreferences = {};
  applyGuestWebPreferences({ webPreferences, ...{ preloadPath: PRELOAD } });
  assert.equal(webPreferences.preload, PRELOAD);
});


test("a preload the PAGE asked for is overwritten, never honoured or merged", () => {


  const webPreferences = { preload: "file:///tmp/attacker-chosen.js" };
  applyGuestWebPreferences({ webPreferences, ...{ preloadPath: PRELOAD } });
  assert.equal(webPreferences.preload, PRELOAD);
});


test("Node stays off and context isolation stays on, whatever the page asked for", () => {
  const webPreferences = { nodeIntegration: true, contextIsolation: false, preload: "/evil.js" };
  applyGuestWebPreferences({ webPreferences, ...{ preloadPath: PRELOAD } });
  assert.equal(webPreferences.nodeIntegration, false);
  assert.equal(webPreferences.contextIsolation, true);
  assert.equal(webPreferences.preload, PRELOAD);
});


test("a missing preload path throws rather than silently producing a guest with no voice API", () => {
  // @ts-expect-error -- no preloadPath: the type rejects it, and this asserts the runtime does too.
  assert.throws(() => applyGuestWebPreferences({ webPreferences: {}, ...{} }), /preloadPath is required/);
  assert.throws(() => applyGuestWebPreferences({ webPreferences: {}, ...{ preloadPath: "" } }), /preloadPath is required/);
});



function attachEvent() {
  const event = { prevented: 0, preventDefault: () => void (event.prevented += 1) };
  return event;
}


const SUPERVISED = "http://127.0.0.1:4567/admin/";

const isSupervised = ({ src }: { src: string }) => src === SUPERVISED;


test("a guest whose src is a supervised site is admitted, and the attach is not prevented", () => {
  const event = attachEvent();
  assert.equal(admitGuestSource({ event, params: { src: SUPERVISED }, ...{ isAllowedSource: isSupervised } }), true);
  assert.equal(event.prevented, 0);
});


test("a guest whose src is any other origin is refused by preventing the attach", () => {


  for (const src of ["https://attacker.example/admin", "http://127.0.0.1:4567@evil.example/admin/", "file:///etc/passwd"]) {
    const event = attachEvent();
    assert.equal(admitGuestSource({ event, params: { src }, ...{ isAllowedSource: isSupervised } }), false, src);
    assert.equal(event.prevented, 1, src);
  }
});


test("a guest with no src, or a non-string src, is refused without asking the predicate", () => {
  const asked: string[] = [];
  const isAllowedSource = ({ src }: { src: string }) => {
    asked.push(src);
    return true;
  };
  for (const params of [{}, { src: undefined }, { src: 42 }, { src: { toString: () => SUPERVISED } }]) {
    const event = attachEvent();
    assert.equal(admitGuestSource({ event, params, ...{ isAllowedSource } }), false);
    assert.equal(event.prevented, 1);
  }
  assert.deepEqual(asked, []);
});


test("a predicate that throws refuses the attach instead of throwing out of Electron's callback", () => {


  const event = attachEvent();
  const isAllowedSource = () => {
    throw new Error("openSites was not ready");
  };
  assert.equal(admitGuestSource({ event, params: { src: SUPERVISED }, ...{ isAllowedSource } }), false);
  assert.equal(event.prevented, 1);
});