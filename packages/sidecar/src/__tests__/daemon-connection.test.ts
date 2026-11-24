import { describe, expect, it } from "vitest";

import { createDaemonConnectionRegistry } from "../daemon-connection.js";

/**
 * Moved from the host's `assistant-daemon-connection` state machine. Named mutation: making `set`
 * retain the previous record unconditionally (also for an identical endpoint and credential) turns
 * the "an unchanged re-set" test red; storing the caller's object without copying and freezing it
 * turns the "copies and freezes" test red.
 */
const a = { url: "http://127.0.0.1:1/s/a", pid: 1, token: "first" };
const b = { url: "http://127.0.0.1:2/s/a", pid: 2, token: "second" };

describe("createDaemonConnectionRegistry", () => {
  it("starts empty", () => {
    const registry = createDaemonConnectionRegistry();
    expect(registry.current()).toBeUndefined();
    expect(registry.previous()).toBeUndefined();
  });

  it("a replacement retains the previous endpoint together with its own credential", () => {
    const registry = createDaemonConnectionRegistry<typeof a>();
    registry.set({ connection: a });
    registry.set({ connection: b });
    expect(registry.current()).toEqual(b);
    expect(registry.previous()).toEqual(a);
    expect(registry.previous()?.token).toBe("first");
  });

  it("a replacement that only rotates the credential on the same url still retains the old pair", () => {
    const registry = createDaemonConnectionRegistry<typeof a>();
    registry.set({ connection: a });
    registry.set({ connection: { ...a, token: "rotated" } });
    expect(registry.previous()).toEqual(a);
    expect(registry.current()?.token).toBe("rotated");
  });

  it("an unchanged re-set keeps the earlier previous record instead of overwriting it with itself", () => {
    const registry = createDaemonConnectionRegistry<typeof a>();
    registry.set({ connection: a });
    registry.set({ connection: b });
    registry.set({ connection: { ...b } });
    expect(registry.previous()).toEqual(a);
  });

  it("clearing keeps the cleared endpoint as the previous one and empties the current", () => {
    const registry = createDaemonConnectionRegistry<typeof a>();
    registry.set({ connection: a });
    registry.set({ connection: undefined });
    expect(registry.current()).toBeUndefined();
    expect(registry.previous()).toEqual(a);
    registry.set({ connection: undefined });
    expect(registry.previous()).toEqual(a);
  });

  it("copies and freezes the record: caller mutation and later replacement cannot change a held one", () => {
    const registry = createDaemonConnectionRegistry<typeof a>();
    const input = { ...a };
    registry.set({ connection: input });
    input.token = "mutated-caller";
    const held = registry.current()!;
    expect(held.token).toBe("first");
    expect(Object.isFrozen(held)).toBe(true);
    registry.set({ connection: { ...a, token: "replacement" } });
    expect(held.token).toBe("first");
  });

  it("reset forgets both records, and two registries never share state", () => {
    const one = createDaemonConnectionRegistry<typeof a>();
    const two = createDaemonConnectionRegistry<typeof a>();
    one.set({ connection: a });
    one.set({ connection: b });
    expect(two.current()).toBeUndefined();
    one.reset();
    expect(one.current()).toBeUndefined();
    expect(one.previous()).toBeUndefined();
  });
});
