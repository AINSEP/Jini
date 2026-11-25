import { expect, test, vi } from "vitest";
import { startBrowserStream, type BrowserStreamPorts } from "../../shell/lib/browser-stream.js";
import { subscribeToSettingsChanges } from "../settings-events.js";

vi.mock("../../shell/lib/browser-stream.js", () => ({ startBrowserStream: vi.fn(() => () => {}) }));

test("principal keys and supplemental revisions remain independent", () => {
  const listeners = new Map<string, EventListenerOrEventListenerObject>();
  const close = vi.fn();
  const open = vi.fn(() => ({ readyState: 1, close, addEventListener: (kind: string, listener: EventListenerOrEventListenerObject) => { listeners.set(kind, listener); } }));
  const urlFor = vi.fn(({ cursor, supplementalRevision }: { workspaceId: string; cursor: string; supplementalRevision: string }) => `${cursor}/${supplementalRevision}`);
  const publishSettings = vi.fn();
  const ports = {} as BrowserStreamPorts;
  const activity = { active: () => false, retain: () => () => {}, subscribe: () => () => {} };
  const supplemental = { event: "preview", consume: ({ data }: { data: string }) => data || undefined };
  subscribeToSettingsChanges({ workspaceId: "ws", principalId: "a", open, ports, activity, urlFor, publishSettings, warn: vi.fn() }, { supplemental });
  subscribeToSettingsChanges({ workspaceId: "ws", principalId: "b", open, ports, activity, urlFor, publishSettings, warn: vi.fn() }, { supplemental });
  const calls = vi.mocked(startBrowserStream).mock.calls;
  const a = calls.at(-2)?.[0];
  const b = calls.at(-1)?.[0];
  expect(a?.key).toBe("settings/ws/a");
  expect(b?.key).toBe("settings/ws/b");
  if (!a || !b) throw new Error("missing feeds");
  const disconnect = a.connect({ emit: a.receive ?? (() => {}) });
  const preview = listeners.get("preview");
  if (typeof preview !== "function") throw new Error("missing preview listener");
  preview(new MessageEvent("preview", { data: "rev-a" }));
  preview(new MessageEvent("preview", { data: "" }));
  const error = listeners.get("error");
  if (typeof error !== "function") throw new Error("missing error listener");
  error(new Event("error"));
  expect(close).not.toHaveBeenCalled();
  disconnect();
  a.connect({ emit: a.receive ?? (() => {}) });
  expect(urlFor).toHaveBeenLastCalledWith({ workspaceId: "ws", cursor: "", supplementalRevision: "rev-a" });
  b.connect({ emit: b.receive ?? (() => {}) });
  expect(urlFor).toHaveBeenLastCalledWith({ workspaceId: "ws", cursor: "", supplementalRevision: "" });
});
