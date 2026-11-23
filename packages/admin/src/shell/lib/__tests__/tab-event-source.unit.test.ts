import { afterEach, expect, it, vi } from "vitest";

import { openTabEventSource } from "../tab-event-source.js";
import { createStreamActivity } from "../stream-activity.js";
import { fakeBrowserOrigin, StreamFake } from "./browser-stream.fakes.js";

/**
 * @file `openTabEventSource`'s EventSource facade on its own: the readyState it reports through
 * connect, idle pause and close; forwarding to both listeners and `on*` handler properties; and that
 * a replaced or disposed native source can no longer reach the bridge. Hand-written tab ports only.
 */

afterEach(() => { vi.unstubAllGlobals(); });

function open() {
  const tab = fakeBrowserOrigin().tab();
  const sources: StreamFake[] = [];
  const managed = openTabEventSource({ url: "/api/bridge" }, {
    ports: tab.ports, activity: createStreamActivity({}),
    open: (url) => { const source = new StreamFake(url); sources.push(source); return source; },
  });
  return { tab, sources, managed };
}

it("forwards message, error and open to listeners and to the on* handlers, with the message fields intact", () => {
  const { sources, managed } = open();
  const seen: string[] = [];
  managed.addEventListener("message", (event) => seen.push(`listener:message:${(event as MessageEvent).data}:${(event as MessageEvent).lastEventId}`));
  managed.addEventListener("error", () => seen.push("listener:error"));
  managed.onmessage = (event) => seen.push(`on:message:${event.data}`);
  managed.onerror = () => seen.push("on:error");
  managed.onopen = () => seen.push("on:open");
  sources[0]!.emit("open");
  sources[0]!.emit("message", "hello", "7");
  sources[0]!.emit("error");
  expect(seen).toEqual(["on:open", "listener:message:hello:7", "on:message:hello", "listener:error", "on:error"]);
  expect(managed.url).toBe("/api/bridge");
  managed.close();
});

it("forwards with no on* handlers set", () => {
  const { sources, managed } = open();
  const kinds: string[] = [];
  for (const kind of ["message", "error", "open"]) managed.addEventListener(kind, () => kinds.push(kind));
  sources[0]!.emit("message", "x"); sources[0]!.emit("error"); sources[0]!.emit("open");
  expect(kinds).toEqual(["message", "error", "open"]);
  managed.close();
});

it("reports the native readyState while connected, CONNECTING while paused, and CLOSED once closed (idempotently)", () => {
  const { tab, sources, managed } = open();
  expect(managed.readyState).toBe(1);
  const suspended: string[] = [];
  managed.addEventListener("suspended", () => suspended.push("suspended"));
  tab.hide(); tab.advance(30_000);
  expect(sources[0]!.closed).toBe(true);
  expect(managed.readyState).toBe(0);
  expect(suspended).toEqual(["suspended"]);
  // The paused source can no longer reach the bridge, even if it fires late.
  const late: string[] = [];
  managed.addEventListener("message", () => late.push("late"));
  sources[0]!.dispatchEvent(new MessageEvent("message", { data: "stale" }));
  expect(late).toEqual([]);
  tab.show();
  expect(sources).toHaveLength(2);
  expect(managed.readyState).toBe(1);
  managed.close();
  expect(managed.readyState).toBe(2);
  expect(sources[1]!.closed).toBe(true);
  expect(suspended).toEqual(["suspended"]);
  managed.close();
  expect(managed.readyState).toBe(2);
  sources[1]!.dispatchEvent(new MessageEvent("message", { data: "after close" }));
  expect(late).toEqual([]);
});

it("opens a native EventSource by default", () => {
  const constructed: string[] = [];
  class FakeEventSource extends StreamFake { constructor(url: string) { super(url); constructed.push(url); } }
  vi.stubGlobal("EventSource", FakeEventSource);
  const tab = fakeBrowserOrigin().tab();
  const managed = openTabEventSource({ url: "/api/default" }, { ports: tab.ports, activity: createStreamActivity({}) });
  expect(constructed).toEqual(["/api/default"]);
  expect(managed.readyState).toBe(1);
  managed.close();
});
