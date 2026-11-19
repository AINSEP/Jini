import { expect, test, vi } from "vitest";
import { EventEmitter } from "node:events";
import { createChildExitSignal } from "../supervisor-node.js";
import { createChildEntries } from "../supervisor.js";

test("exit capture is attached immediately and replays synchronously to every late subscriber", () => {
  const child = new EventEmitter(); const signal = createChildExitSignal({ child });
  expect(child.listenerCount("exit")).toBe(1);
  child.emit("exit", null, "SIGKILL"); const first = vi.fn(); const second = vi.fn();
  signal.onExit({ listener: first }); expect(first).toHaveBeenCalledWith({ code: null, signal: "SIGKILL" });
  signal.onExit({ listener: second }); expect(second).toHaveBeenCalledWith({ code: null, signal: "SIGKILL" });
  expect(first).toHaveBeenCalledTimes(1); expect(second).toHaveBeenCalledTimes(1);
});

test("early listeners receive exactly one outcome, preserving Node code and signal", () => {
  const child = new EventEmitter(); const signal = createChildExitSignal({ child }); const first = vi.fn(); const second = vi.fn();
  signal.onExit({ listener: first }); signal.onExit({ listener: second });
  child.emit("exit", 7, null); child.emit("exit", 9, "SIGTERM");
  expect(first.mock.calls).toEqual([[{ code: 7, signal: null }]]); expect(second.mock.calls).toEqual(first.mock.calls);
  const late = vi.fn(); signal.onExit({ listener: late }); expect(late.mock.calls).toEqual(first.mock.calls);
});

test("the repaired entry store observes synchronous replay through the real subscription shape", () => {
  const child = new EventEmitter(); const server = createChildExitSignal({ child }); const report = vi.fn();
  const entries = createChildEntries({ onUnexpectedExit: report }); const entry = { server };
  child.emit("exit", 1, null); entries.set("child", entry);
  expect(entries.has("child")).toBe(false);
  expect(report.mock.calls).toEqual([[{ key: "child", entry, exit: { code: 1, signal: null } }]]);
});
