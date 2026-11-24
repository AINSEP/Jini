import { describe, expect, it } from "vitest";
import { copyPgliteSourceTo, type PgliteSourceCopyPorts } from "../copy-source.js";

function fixture({ owner, lockFails, openFails, copyFails, closeFails }: { owner?: string; lockFails?: boolean; openFails?: boolean; copyFails?: boolean; closeFails?: boolean } = {}) {
  const calls: string[] = [];
  const ports: PgliteSourceCopyPorts<string, { close(): Promise<void> }> = {
    runningOwner: () => owner,
    copyServed: async ({ owner: o, targetPath }) => { calls.push(`served ${o} -> ${targetPath}`); },
    acquireOwnerLock: () => { calls.push("lock"); if (lockFails) throw new Error("locked"); return () => { calls.push("release"); }; },
    openStopped: () => { calls.push("open"); if (openFails) throw new Error("open failed"); return { close: async () => { calls.push("close"); if (closeFails) throw new Error("close failed"); } }; },
    copyStopped: async ({ targetPath }) => { calls.push(`copy -> ${targetPath}`); if (copyFails) throw new Error("copy failed"); },
  };
  return { calls, ports };
}

describe("copyPgliteSourceTo", () => {
  it("copies a served source through its owner without taking the lock", async () => {
    const f = fixture({ owner: "owner-1" });
    await copyPgliteSourceTo({ sourceDataDir: "/s", targetDataDir: "/t", ports: f.ports });
    expect(f.calls).toEqual(["served owner-1 -> /t"]);
  });

  it("copies a stopped source under the owner lock: lock, open, copy, close, release", async () => {
    const f = fixture();
    await copyPgliteSourceTo({ sourceDataDir: "/s", targetDataDir: "/t", ports: f.ports });
    expect(f.calls).toEqual(["lock", "open", "copy -> /t", "close", "release"]);
  });

  it("a refused lock propagates and nothing is opened", async () => {
    const f = fixture({ lockFails: true });
    await expect(copyPgliteSourceTo({ sourceDataDir: "/s", targetDataDir: "/t", ports: f.ports })).rejects.toThrow("locked");
    expect(f.calls).toEqual(["lock"]);
  });

  it.each([
    ["a synchronous open failure", { openFails: true }, "open failed", ["lock", "open", "release"]],
    ["a copy failure", { copyFails: true }, "copy failed", ["lock", "open", "copy -> /t", "close", "release"]],
    ["a rejected close", { closeFails: true }, "close failed", ["lock", "open", "copy -> /t", "close", "release"]],
  ])("%s still releases the lock", async (_name, options, message, calls) => {
    const f = fixture(options);
    await expect(copyPgliteSourceTo({ sourceDataDir: "/s", targetDataDir: "/t", ports: f.ports })).rejects.toThrow(message);
    expect(f.calls).toEqual(calls);
  });
});
