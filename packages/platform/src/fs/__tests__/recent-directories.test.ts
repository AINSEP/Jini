import { expect, test, vi } from "vitest";
import { readRecentDirectories, rememberRecentDirectory, type DurableJsonFile } from "../index.js";
import type { JsonFileRead } from "@jini-ai/core/contracts/site/fs-durable-json";

const field = "folders";
const notice = { label: "recent directories", consequence: "the previous list remains in the copy" };

function memoryFile(initial: JsonFileRead) {
  let state = initial;
  return {
    read: vi.fn((_required: Record<string, never>) => state),
    write: vi.fn(({ value }: { value: unknown }) => { state = { state: "ok", value }; }),
    quarantine: vi.fn((_required: { notice: typeof notice }) => true),
    withLock<T>({ critical }: { critical: () => T }): T { return critical(); },
  } satisfies Pick<DurableJsonFile, "read" | "write" | "quarantine" | "withLock">;
}

test("missing and unreadable files read as empty; only unreadable files are quarantined", () => {
  for (const state of [{ state: "missing" }, { state: "unreadable", text: "{ truncated" }] as const) {
    const file = memoryFile(state);
    expect(readRecentDirectories({ file, field })).toEqual([]);
    expect(rememberRecentDirectory({ file, field, directory: "/new", maxEntries: 10, notice })).toEqual(["/new"]);
    expect(file.quarantine).toHaveBeenCalledTimes(state.state === "missing" ? 0 : 1);
    expect(file.write).toHaveBeenCalledWith({ value: { folders: ["/new"] } });
  }
});

test("a non-array field is damaged and quarantined before writing", () => {
  const file = memoryFile({ state: "ok", value: { folders: "invalid" } });
  const effects: string[] = [];
  file.quarantine.mockImplementation(() => { effects.push("quarantine"); return true; });
  file.write.mockImplementation(() => { effects.push("write"); });
  expect(readRecentDirectories({ file, field })).toEqual([]);
  expect(rememberRecentDirectory({ file, field, directory: "/new", maxEntries: 10, notice })).toEqual(["/new"]);
  expect(file.quarantine).toHaveBeenCalledWith({ notice });
  expect(effects).toEqual(["quarantine", "write"]);
});

test("reads drop non-strings and apply eligibility without changing storage", () => {
  const value = { folders: ["/gone", null, 7, "/alive", {}] };
  const file = memoryFile({ state: "ok", value });
  expect(readRecentDirectories({ file, field })).toEqual(["/gone", "/alive"]);
  expect(readRecentDirectories({ file, field }, { isEligible: ({ directory }) => directory === "/alive" })).toEqual(["/alive"]);
  expect(file.read({})).toEqual({ state: "ok", value });
  expect(file.write).not.toHaveBeenCalled();
});

test("remembering puts the newest directory first and removes its previous occurrences", () => {
  const file = memoryFile({ state: "missing" });
  for (const directory of ["/a", "/b", "/a"]) rememberRecentDirectory({ file, field, directory, maxEntries: 10, notice });
  expect(readRecentDirectories({ file, field })).toEqual(["/a", "/b"]);
});

test("the cap applies to writes and never truncates reads", () => {
  const file = memoryFile({ state: "ok", value: { folders: ["/a", "/b", "/c"] } });
  expect(readRecentDirectories({ file, field })).toEqual(["/a", "/b", "/c"]);
  expect(rememberRecentDirectory({ file, field, directory: "/new", maxEntries: 2, notice })).toEqual(["/new", "/a"]);
  expect(file.write).toHaveBeenCalledWith({ value: { folders: ["/new", "/a"] } });
});

test("the read happens after entering the lock", () => {
  const file = memoryFile({ state: "ok", value: { folders: ["/a"] } });
  file.withLock = ({ critical }) => {
    file.write({ value: { folders: ["/other-process", "/a"] } });
    return critical();
  };
  expect(rememberRecentDirectory({ file, field, directory: "/new", maxEntries: 10, notice })).toEqual(["/new", "/other-process", "/a"]);
  expect(file.read({})).toEqual({ state: "ok", value: { folders: ["/new", "/other-process", "/a"] } });
});

test("quarantine refusal returns the computed list and leaves damaged bytes untouched", () => {
  const state = { state: "unreadable", text: "{ truncated" } as const;
  const file = memoryFile(state);
  file.quarantine.mockReturnValue(false);
  expect(rememberRecentDirectory({ file, field, directory: "/new", maxEntries: 10, notice })).toEqual(["/new"]);
  expect(file.quarantine).toHaveBeenCalledWith({ notice });
  expect(file.write).not.toHaveBeenCalled();
  expect(file.read({})).toEqual(state);
});
