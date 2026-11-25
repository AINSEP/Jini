import { expect, it, vi } from "vitest";
import { fingerprintRootKeyHex } from "../../keyring.env.js";
import { reconcileRootKey, type RootKeyReconcilePorts } from "../reconcile.js";

const candidate = "11".repeat(32);
const prior = "22".repeat(32);
const winner = "33".repeat(32);
const fingerprint = (hex: string) => fingerprintRootKeyHex({ hex });

function fixture() {
  const order: string[] = [];
  const write = vi.fn(({ fingerprint: value }: { fingerprint: string }) => { order.push(`stamp:${value}`); });
  const ports: RootKeyReconcilePorts = {
    readPerSite: vi.fn(() => undefined), others: [], stampedFingerprint: undefined,
    hasDependentData: vi.fn(async () => false),
    moveAside: vi.fn(({ expectedContent }) => { order.push(`move:${expectedContent}`); }),
    createExclusive: vi.fn(({ hex }) => { order.push(`create:${hex}`); return hex; }),
    mint: vi.fn(() => candidate),
    readStamp: vi.fn(() => ({ kind: "meta", fingerprint: undefined, write })),
  };
  return { ports, write, order };
}

it("mismatched adoption with dependent data writes and stamps nothing", async () => {
  const f = fixture();
  const result = await reconcileRootKey({ ports: { ...f.ports, others: [() => candidate], stampedFingerprint: fingerprint(prior), hasDependentData: async () => true } });
  expect(result).toEqual({ action: "mismatch", fingerprint: fingerprint(candidate) });
  expect(f.ports.createExclusive).not.toHaveBeenCalled();
  expect(f.write).not.toHaveBeenCalled();
});

it("a stamp-named key in another source replaces a different per-site file by move-aside, never delete", async () => {
  const f = fixture();
  const raw = ` ${prior}\n`;
  const result = await reconcileRootKey({ ports: { ...f.ports,
    readPerSite: () => raw, others: [() => candidate], stampedFingerprint: fingerprint(candidate),
    readStamp: () => ({ kind: "meta", fingerprint: fingerprint(candidate), write: f.write }),
  } });
  expect(result).toEqual({ action: "adopt", fingerprint: fingerprint(candidate) });
  expect(f.order).toEqual([`move:${raw}`, `create:${candidate}`]);
  expect(f.ports.moveAside).toHaveBeenCalledExactlyOnceWith({ expectedContent: raw });
  expect(f.write).not.toHaveBeenCalled();
});

it("a differing stamp with dependent data reports mismatch and does not restamp", async () => {
  const f = fixture();
  const result = await reconcileRootKey({ ports: { ...f.ports, others: [() => candidate], stampedFingerprint: fingerprint(candidate),
    createExclusive: () => winner, hasDependentData: async () => true,
    readStamp: () => ({ kind: "meta", fingerprint: fingerprint(candidate), write: f.write }),
  } });
  expect(result).toEqual({ action: "mismatch", fingerprint: fingerprint(winner) });
  expect(f.write).not.toHaveBeenCalled();
});

it("a lost create race returns the winner's fingerprint", async () => {
  const f = fixture();
  const result = await reconcileRootKey({ ports: { ...f.ports, createExclusive: () => winner } });
  expect(result).toEqual({ action: "mint", fingerprint: fingerprint(winner) });
  expect(f.write).toHaveBeenCalledExactlyOnceWith({ fingerprint: fingerprint(winner) });
});

it("the dependent-data scan runs at most once per reconcile", async () => {
  const f = fixture();
  const result = await reconcileRootKey({ ports: { ...f.ports,
    stampedFingerprint: fingerprint(prior), readStamp: () => ({ kind: "meta", fingerprint: fingerprint(prior), write: f.write }),
  } });
  expect(result).toEqual({ action: "mint", fingerprint: fingerprint(candidate) });
  expect(f.ports.hasDependentData).toHaveBeenCalledTimes(1);
});

it("absent everywhere with dependent data refuses and writes nothing", async () => {
  const f = fixture();
  expect(await reconcileRootKey({ ports: { ...f.ports, hasDependentData: async () => true } })).toEqual({ action: "refuse" });
  expect(f.ports.mint).not.toHaveBeenCalled();
  expect(f.ports.createExclusive).not.toHaveBeenCalled(); expect(f.write).not.toHaveBeenCalled();
});

it("a later source is not read once the stamped key is found", async () => {
  const f = fixture();
  const later = vi.fn(() => { throw new Error("late source read"); });
  const result = await reconcileRootKey({ ports: { ...f.ports, others: [() => candidate, later], stampedFingerprint: fingerprint(candidate) } });
  expect(result.action).toBe("adopt"); expect(later).not.toHaveBeenCalled();
});

it("no meta file means no stamp write, and the action is unchanged", async () => {
  const f = fixture();
  expect(await reconcileRootKey({ ports: { ...f.ports, readStamp: () => ({ kind: "no-meta" }) } })).toEqual({ action: "mint", fingerprint: fingerprint(candidate) });
  expect(f.write).not.toHaveBeenCalled();
});

it("an unstamped meta file is stamped once", async () => {
  const f = fixture();
  expect(await reconcileRootKey({ ports: { ...f.ports, readPerSite: () => candidate } })).toEqual({ action: "noop", fingerprint: fingerprint(candidate) });
  expect(f.write).toHaveBeenCalledExactlyOnceWith({ fingerprint: fingerprint(candidate) });
});
