import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDirectoryUnderLeases, type LeasedDirectoryMovePorts } from "../leased-directory-move.js";

function fixture({ sourceBusy = false, targetBusy = false, relocateFails = false, idleFails = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "leased-move-"));
  const calls: string[] = [];
  const ports: LeasedDirectoryMovePorts = {
    assertIdle: ({ from }) => { calls.push(`idle ${from}`); if (idleFails) throw new Error("running"); },
    claim: ({ path: p }) => { calls.push(`claim ${path.basename(p)}`); return (p.endsWith("from") ? sourceBusy : targetBusy) ? { acquired: false } : { acquired: true, token: `t-${path.basename(p)}` }; },
    release: ({ path: p, token }) => { calls.push(`release ${path.basename(p)} ${token}`); },
    prepareDestination: () => { calls.push("prepare"); },
    relocate: () => { calls.push("relocate"); if (relocateFails) throw new Error("copy failed"); },
    sourceClaimRefused: ({ path: p }) => new Error(`source busy ${path.basename(p)}`),
    targetClaimRefused: ({ path: p }) => new Error(`target busy ${path.basename(p)}`),
  };
  return { root, from: path.join(root, "from"), to: path.join(root, "to"), calls, ports };
}

describe("moveDirectoryUnderLeases", () => {
  it("checks idleness, claims source then target, prepares, relocates, then releases both", async () => {
    const f = fixture();
    await moveDirectoryUnderLeases({ from: f.from, to: f.to, ports: f.ports });
    expect(f.calls).toEqual([`idle ${f.from}`, "claim from", "claim to", "prepare", "relocate", "release from t-from", "release to t-to"]);
  });

  it("releases both claims when the relocation fails, and rethrows its error", async () => {
    const f = fixture({ relocateFails: true });
    await expect(moveDirectoryUnderLeases({ from: f.from, to: f.to, ports: f.ports })).rejects.toThrow("copy failed");
    expect(f.calls.slice(-2)).toEqual(["release from t-from", "release to t-to"]);
  });

  it("a refused target claim releases only the source claim and never relocates", async () => {
    const f = fixture({ targetBusy: true });
    await expect(moveDirectoryUnderLeases({ from: f.from, to: f.to, ports: f.ports })).rejects.toThrow("target busy to");
    expect(f.calls).toEqual([`idle ${f.from}`, "claim from", "claim to", "release from t-from"]);
  });

  it("a refused source claim and a busy source stop before anything is claimed or moved", async () => {
    const a = fixture({ sourceBusy: true });
    await expect(moveDirectoryUnderLeases({ from: a.from, to: a.to, ports: a.ports })).rejects.toThrow("source busy from");
    expect(a.calls).toEqual([`idle ${a.from}`, "claim from"]);
    const b = fixture({ idleFails: true });
    await expect(moveDirectoryUnderLeases({ from: b.from, to: b.to, ports: b.ports })).rejects.toThrow("running");
    expect(b.calls).toEqual([`idle ${b.from}`]);
  });
});
