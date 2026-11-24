// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAssistantAgentsSnapshot, type CreateAgentInventoryStore } from "../assistant-agents-snapshot.js";

/**
 * @file `createAssistantAgentsSnapshot` — the binding of the shared fail-soft inventory snapshot to
 * `localStorage` under the host's key. The shared snapshot's own parsing and failure handling are
 * tested where it lives; the host pins its composition (real factory + its existing key). A
 * minimal in-memory factory stands in here so these tests see exactly what the binding passes.
 */

/** A pass-through factory: stores JSON through whatever storage/key the binding supplied. */
function recordingFactory() {
  const calls: { key: string }[] = [];
  const factory: CreateAgentInventoryStore = ({ storage, key }) => {
    calls.push({ key });
    return {
      read: () => {
        const raw = storage.getItem(key);
        return raw ? JSON.parse(raw) : undefined;
      },
      write: ({ agents }) => storage.setItem(key, JSON.stringify(agents)),
    };
  };
  return { calls, factory };
}

describe("createAssistantAgentsSnapshot", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("builds the shared snapshot under exactly the host-injected key", () => {
    const { calls, factory } = recordingFactory();
    createAssistantAgentsSnapshot({ storageKey: "host.agents.v1", createInventorySnapshot: factory });
    expect(calls).toEqual([{ key: "host.agents.v1" }]);
  });

  it("round-trips a live list through window.localStorage under that key", () => {
    const { factory } = recordingFactory();
    const { readAgentsSnapshot, writeAgentsSnapshot } = createAssistantAgentsSnapshot({ storageKey: "host.agents.v1", createInventorySnapshot: factory });

    writeAgentsSnapshot({ agents: [{ id: "claude", name: "Claude Code" }] });

    expect(JSON.parse(localStorage.getItem("host.agents.v1") ?? "null")).toEqual([{ id: "claude", name: "Claude Code" }]);
    expect(readAgentsSnapshot()).toEqual([{ id: "claude", name: "Claude Code" }]);
    expect(localStorage.length).toBe(1);
  });

  it("touches storage lazily, so a throwing localStorage surfaces inside the snapshot's own calls", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const { factory } = recordingFactory();
    const { readAgentsSnapshot } = createAssistantAgentsSnapshot({ storageKey: "host.agents.v1", createInventorySnapshot: factory });
    expect(getItem).not.toHaveBeenCalled();

    readAgentsSnapshot();
    expect(getItem).toHaveBeenCalledWith("host.agents.v1");
  });
});
