import assert from "node:assert/strict";
import { test } from "vitest";

import { createSitePresence, type PresenceSender } from "../site-presence.js";

/**
 * @file Site presence over fake senders: trusted-sender and tracked-id validation, replace-in-place,
 * release on either lifecycle event (once, with both listeners removed), the window fallback and dispose.
 */

function sender(): PresenceSender & { destroyed: boolean; fire(name: string): void; listeners: Map<string, () => void>; removed: string[] } {
  const listeners = new Map<string, () => void>();
  const removed: string[] = [];
  return {
    destroyed: false, listeners, removed,
    isDestroyed() { return this.destroyed; },
    once(name, listener) { listeners.set(name, listener); },
    removeListener(name, listener) { if (listeners.get(name) === listener) { listeners.delete(name); removed.push(name); } },
    fire(name) { listeners.get(name)?.(); },
  };
}
const tracked = () => new Set(["a", "b"]);

test("refuses an untrusted or destroyed sender and untracked or malformed ids", () => {
  const trusted = sender();
  const presence = createSitePresence({ allowed: (s) => s === trusted, trackedIds: tracked });
  assert.throws(() => presence.replace({ sender: sender(), siteIds: ["a"] }), /UNTRUSTED_SITE_PRESENCE_SENDER/);
  trusted.destroyed = true;
  assert.throws(() => presence.replace({ sender: trusted, siteIds: ["a"] }), /UNTRUSTED_SITE_PRESENCE_SENDER/);
  trusted.destroyed = false;
  for (const siteIds of ["a", ["zzz"], [1]]) assert.throws(() => presence.replace({ sender: trusted, siteIds }), /INVALID_SITE_PRESENCE/);
  assert.equal(presence.has({ siteId: "a" }), false);
});

test("replace updates in place; either lifecycle event releases once and removes both listeners", () => {
  let releases = 0;
  const s = sender();
  const presence = createSitePresence({ allowed: () => true, trackedIds: tracked }, { onRelease: () => { releases += 1; } });
  presence.replace({ sender: s, siteIds: ["a"] });
  presence.replace({ sender: s, siteIds: ["b"] });
  assert.deepEqual([presence.has({ siteId: "a" }), presence.has({ siteId: "b" })], [false, true]);
  s.fire("render-process-gone");
  s.fire("destroyed");
  assert.equal(releases, 1);
  assert.deepEqual(s.removed.sort(), ["destroyed", "render-process-gone"]);
  assert.equal(presence.has({ siteId: "b" }), false);
});

test("an open site window counts as presence, and dispose releases every owner", () => {
  let releases = 0;
  const presence = createSitePresence({ allowed: () => true, trackedIds: tracked }, { hasSiteWindow: ({ siteId }) => siteId === "b", onRelease: () => { releases += 1; } });
  assert.equal(presence.has({ siteId: "b" }), true);
  presence.replace({ sender: sender(), siteIds: ["a"] });
  presence.replace({ sender: sender(), siteIds: ["a"] });
  presence.dispose();
  assert.equal(releases, 2);
  assert.equal(presence.has({ siteId: "a" }), false);
  assert.equal(createSitePresence({ allowed: () => true, trackedIds: tracked }).has({ siteId: "b" }), false);
});

test("a sender that keeps firing after release (removeListener a no-op) releases once; default onRelease is inert", () => {
  let releases = 0;
  const listeners: (() => void)[] = [];
  const sticky: PresenceSender = { isDestroyed: () => false, once: (_name, listener) => { listeners.push(listener); }, removeListener: () => undefined };
  const presence = createSitePresence({ allowed: () => true, trackedIds: tracked }, { onRelease: () => { releases += 1; } });
  presence.replace({ sender: sticky, siteIds: ["a"] });
  for (const listener of listeners) listener();
  assert.equal(releases, 1, "the second lifecycle event finds no owner and is ignored");
  const quiet = createSitePresence({ allowed: () => true, trackedIds: tracked });
  quiet.replace({ sender: sender(), siteIds: ["a"] });
  quiet.dispose();
  assert.equal(quiet.has({ siteId: "a" }), false);
});
