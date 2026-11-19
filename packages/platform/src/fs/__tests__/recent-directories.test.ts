import { describe, expect, it, vi } from "vitest";
import { readRecentDirectories, rememberRecentDirectory, type JsonFileRead } from "../index.js";

describe("recent directories", () => {
  it("reads missing, unreadable and malformed lists as empty and filters values without writing", () => {
    let state: JsonFileRead = { state: "missing" };
    const file = { read: () => state };
    expect(readRecentDirectories({ file, field: "folders" })).toEqual([]);
    state = { state: "unreadable" };
    expect(readRecentDirectories({ file, field: "folders" })).toEqual([]);
    state = { state: "ok", value: { folders: "bad" } };
    expect(readRecentDirectories({ file, field: "folders" })).toEqual([]);
    state = { state: "ok", value: { folders: ["a", 3, "b"] } };
    expect(readRecentDirectories({ file, field: "folders" })).toEqual(["a", "b"]);
    expect(readRecentDirectories({ file, field: "folders" }, { isEligible: ({ directory }) => directory === "b" })).toEqual(["b"]);
    expect(state.value).toEqual({ folders: ["a", 3, "b"] });
  });

  it("locks before reading, prepends, deduplicates and caps writes", () => {
    let value: unknown = { folders: ["old"] };
    const file = {
      read: (): JsonFileRead => ({ state: "ok", value }),
      write: ({ value: next }: { value: unknown }) => { value = next; },
      quarantine: vi.fn(() => true),
      withLock: <T>({ critical }: { critical: () => T }): T => { value = { folders: ["new", "other", "old"] }; return critical(); },
    };
    expect(rememberRecentDirectory({ file, field: "folders", directory: "new", maxEntries: 2, notice: { label: "cache", consequence: "lost" } })).toEqual(["new", "other"]);
    expect(value).toEqual({ folders: ["new", "other"] });
    expect(file.quarantine).not.toHaveBeenCalled();
  });

  it("quarantines damaged state and leaves it untouched on refusal; missing is clean", () => {
    let state: JsonFileRead = { state: "missing" };
    const write = vi.fn();
    const quarantine = vi.fn(() => false);
    const file = { read: () => state, write, quarantine, withLock: <T>({ critical }: { critical: () => T }): T => critical() };
    const args = { file, field: "folders", directory: "new", maxEntries: 2, notice: { label: "cache", consequence: "lost" } };
    expect(rememberRecentDirectory(args)).toEqual(["new"]);
    expect(quarantine).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledWith({ value: { folders: ["new"] } });
    write.mockClear();
    for (const damaged of [{ state: "unreadable" }, { state: "ok", value: { folders: "bad" } }] as JsonFileRead[]) {
      state = damaged;
      expect(rememberRecentDirectory(args)).toEqual(["new"]);
      expect(write).not.toHaveBeenCalled();
    }
    expect(quarantine).toHaveBeenCalledTimes(2);
    quarantine.mockReturnValue(true);
    expect(rememberRecentDirectory(args)).toEqual(["new"]);
    expect(write).toHaveBeenCalledWith({ value: { folders: ["new"] } });
  });
});
