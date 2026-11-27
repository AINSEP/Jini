// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { subscribeToSettingsChanges } from "../settings-events.js";
import type { BrowserStreamPorts } from "../../shell/lib/browser-stream.js";
import { createStreamActivity } from "../../shell/lib/stream-activity.js";

class FeedSource extends EventTarget {
  readyState = 1;
  close() { this.readyState = 2; }

  settings(data: string, lastEventId = "") {
    this.dispatchEvent(new MessageEvent("settings-changed", { data, lastEventId }));
  }
}

function subscribe(open: Parameters<typeof subscribeToSettingsChanges>[0]["open"]) {
  const page = new EventTarget();
  const visibility = Object.assign(new EventTarget(), { visibilityState: "visible" as const });
  const ports: BrowserStreamPorts = {
    visibility, page, now: () => 0,
    schedule: () => { throw new Error("Visible streams must not schedule an idle timer"); },
    orFallbackSync: ({ work }) => work(),
  };
  const publishSettings = vi.fn();
  const warn = vi.fn();
  const urlFor = vi.fn(({ cursor }: { cursor: string }) => "/settings/feed?after=" + cursor);
  const stop = subscribeToSettingsChanges({
    workspaceId: "workspace-9", principalId: "owner-2", open, ports,
    activity: createStreamActivity(), urlFor, publishSettings, warn,
  });
  return { stop, page, publishSettings, warn, urlFor };
}

it("refreshes scoped settings, falls back for unexpected frames, and catches up on re-open", () => {
  const source = new FeedSource();
  const { stop, publishSettings } = subscribe(() => source);
  try {
    source.dispatchEvent(new Event("open"));
    expect(publishSettings.mock.calls).toEqual([]);

    source.settings('{"namespaces":["appearance","identity"]}', "73");
    source.settings('{"namespaces":"appearance"}');
    source.settings("not-json");
    source.dispatchEvent(new Event("open"));
    expect(publishSettings.mock.calls).toEqual([[["appearance", "identity"]], [undefined], [], []]);
  } finally {
    stop();
  }
  expect(source.readyState).toBe(2);
  source.settings('{"namespaces":["late"]}');
  expect(publishSettings.mock.calls).toHaveLength(4);
});

it("resumes from the last event id across pagehide and refreshes on the new connection's first open", () => {
  const first = new FeedSource();
  const second = new FeedSource();
  const open = vi.fn((url: string) => {
    if (url === "/settings/feed?after=") return first;
    if (url === "/settings/feed?after=73") return second;
    throw new Error(`Unexpected feed URL: ${url}`);
  });
  const { stop, page, publishSettings, urlFor } = subscribe(open);
  try {
    first.settings('{"namespaces":["appearance"]}', "73");
    first.settings('{"namespaces":["identity"]}');
    page.dispatchEvent(new Event("pagehide"));
    expect(first.readyState).toBe(2);
    page.dispatchEvent(new Event("pageshow"));
    second.dispatchEvent(new Event("open"));
    expect(urlFor.mock.calls).toEqual([
      [{ workspaceId: "workspace-9", cursor: "", supplementalRevision: "" }],
      [{ workspaceId: "workspace-9", cursor: "73", supplementalRevision: "" }],
    ]);
    expect(open.mock.calls).toEqual([["/settings/feed?after="], ["/settings/feed?after=73"]]);
    expect(publishSettings.mock.calls).toEqual([[["appearance"]], [["identity"]], []]);
  } finally {
    stop();
  }
});

it("reports construction failure and attaches normally when the page returns", () => {
  const error = new Error("EventSource unavailable");
  const source = new FeedSource();
  const open = vi.fn(() => source).mockImplementationOnce(() => { throw error; });
  const { stop, page, warn, publishSettings } = subscribe(open);
  try {
    expect(warn.mock.calls).toEqual([["[admin] settings change feed unavailable", error]]);
    page.dispatchEvent(new Event("pagehide"));
    page.dispatchEvent(new Event("pageshow"));
    source.dispatchEvent(new Event("open"));
    expect(publishSettings.mock.calls).toEqual([]);
    source.dispatchEvent(new Event("error"));
    expect(warn.mock.calls).toEqual([["[admin] settings change feed unavailable", error]]);
    source.readyState = 2;
    source.dispatchEvent(new Event("error"));
    expect(warn.mock.calls).toEqual([
      ["[admin] settings change feed unavailable", error],
      ["[admin] settings change feed closed by the server; no further updates on this connection"],
    ]);
  } finally {
    stop();
  }
});
