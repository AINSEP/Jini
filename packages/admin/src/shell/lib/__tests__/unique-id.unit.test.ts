import { afterEach, expect, it, vi } from "vitest";
import { uniqueId } from "../unique-id.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("uses the platform UUID without reading time", () => {
  vi.stubGlobal("crypto", { randomUUID: () => "12345678-1234-4123-8123-123456789abc" });
  const clock = vi.spyOn(Date, "now").mockReturnValue(123);
  expect(uniqueId()).toBe("12345678-1234-4123-8123-123456789abc");
  expect(clock).not.toHaveBeenCalled();
});

it("uses both 32-bit words from Web Crypto when UUIDs are unavailable", () => {
  vi.spyOn(Date, "now").mockReturnValue(123);
  const pairs = [[35, 36], [35, 42], [29, 42]];
  const getRandomValues = vi.fn((words: Uint32Array) => {
    const pair = pairs.shift();
    if (!pair) throw new Error("Expected only three ID requests");
    words.set(pair);
    return words;
  });
  vi.stubGlobal("crypto", { getRandomValues });
  const generated = [uniqueId(), uniqueId(), uniqueId()];
  for (const id of generated) expect(id).toMatch(/^123-[a-z0-9-]+$/);
  expect(new Set(generated).size).toBe(3);
  expect(getRandomValues.mock.calls).toEqual([
    [new Uint32Array([35, 36])], [new Uint32Array([35, 42])], [new Uint32Array([29, 42])],
  ]);
});

it("keeps two IDs unique within the same millisecond even with no Web Crypto", () => {
  vi.spyOn(Date, "now").mockReturnValue(123);
  vi.stubGlobal("crypto", undefined);
  expect(uniqueId()).toBe("123-1");
  expect(uniqueId()).toBe("123-2");
});

it("refuses a host random source that does not fill the two-word contract", () => {
  vi.spyOn(Date, "now").mockReturnValue(123);
  vi.stubGlobal("crypto", { getRandomValues: () => new Uint32Array([35]) });
  expect(() => uniqueId()).toThrow("unique id random source returned fewer than two values");
});

it("keeps different random word pairs distinct in the same millisecond", () => {
  vi.spyOn(Date, "now").mockReturnValue(123);
  const pairs = [[1, 36], [37, 0]];
  vi.stubGlobal("crypto", { getRandomValues: (words: Uint32Array) => {
    const pair = pairs.shift();
    if (!pair) throw new Error("Expected only two ID requests");
    words.set(pair);
    return words;
  } });
  const first = uniqueId();
  const second = uniqueId();
  expect(first).toMatch(/^123-/);
  expect(second).toMatch(/^123-/);
  expect(first).not.toBe(second);
});
