import { describe, expect, it } from "vitest";

import {
  approximateJsonBytes,
  checkpointGrew,
  hasUnsavedCheckpointGrowth,
  releaseUnreadBody,
  reportSafely,
} from "../run-finalizer.js";

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const progress = (textCharacters: number, extensionEvents: number, tools: string[]) => ({ textCharacters, extensionEvents, tools: new Set(tools) });

describe("approximateJsonBytes", () => {
  it("counts string characters and one unit per scalar, recursing through arrays and objects", () => {
    expect(approximateJsonBytes({ value: "abcd" })).toBe(4);
    expect(approximateJsonBytes({ value: null })).toBe(1);
    expect(approximateJsonBytes({ value: 42 })).toBe(1);
    expect(approximateJsonBytes({ value: true })).toBe(1);
    expect(approximateJsonBytes({ value: [] })).toBe(0);
    expect(approximateJsonBytes({ value: ["ab", 1, { k: "xyz", n: null }] })).toBe(2 + 1 + 3 + 1);
  });
});

describe("checkpointGrew", () => {
  const previous = progress(10, 1, ["a"]);
  it("is false for an identical or shrunken (replay-prefix) projection", () => {
    expect(checkpointGrew({ previous, progress: progress(10, 1, ["a"]) })).toBe(false);
    expect(checkpointGrew({ previous, progress: progress(3, 0, []) })).toBe(false);
  });
  it("is true for more text, more extension receipts, or a new tool identity", () => {
    expect(checkpointGrew({ previous, progress: progress(11, 1, ["a"]) })).toBe(true);
    expect(checkpointGrew({ previous, progress: progress(10, 2, ["a"]) })).toBe(true);
    expect(checkpointGrew({ previous, progress: progress(10, 1, ["a", "b"]) })).toBe(true);
  });
});

describe("hasUnsavedCheckpointGrowth", () => {
  const watch = { checkpointedTextCharacters: 5, checkpointedExtensionEvents: 2, checkpointedTools: new Set(["t1"]) };
  it("compares with the watch's last successful save", () => {
    expect(hasUnsavedCheckpointGrowth({ watch, progress: progress(5, 2, ["t1"]) })).toBe(false);
    expect(hasUnsavedCheckpointGrowth({ watch, progress: progress(6, 2, ["t1"]) })).toBe(true);
    expect(hasUnsavedCheckpointGrowth({ watch, progress: progress(5, 3, ["t1"]) })).toBe(true);
    expect(hasUnsavedCheckpointGrowth({ watch, progress: progress(5, 2, ["t2"]) })).toBe(true);
  });
});

describe("reportSafely", () => {
  it("runs the reporter synchronously", () => {
    const calls: string[] = [];
    reportSafely({ report: () => { calls.push("reported"); } });
    expect(calls).toEqual(["reported"]);
  });
  it("contains a synchronous throw and an asynchronous rejection without an unhandled rejection", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on("unhandledRejection", onUnhandled);
    try {
      expect(() => reportSafely({ report: () => { throw new Error("sync log failure"); } })).not.toThrow();
      reportSafely({ report: () => Promise.reject(new Error("async log failure")) });
      await flush();
      await flush();
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(unhandled).toEqual([]);
  });
});

describe("releaseUnreadBody", () => {
  it("cancels an unread body without awaiting it", async () => {
    let canceled = false;
    const body = new ReadableStream({ cancel: () => { canceled = true; } });
    releaseUnreadBody({ response: new Response(body) });
    await flush();
    expect(canceled).toBe(true);
  });
  it("is a no-op for a bodiless response and swallows a failed cancel", async () => {
    expect(() => releaseUnreadBody({ response: new Response(null, { status: 204 }) })).not.toThrow();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on("unhandledRejection", onUnhandled);
    try {
      const failing = { body: { cancel: () => Promise.reject(new Error("cancel failed")) } } as unknown as Response;
      releaseUnreadBody({ response: failing });
      await flush();
      await flush();
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(unhandled).toEqual([]);
  });
});
