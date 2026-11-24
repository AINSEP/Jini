import { describe, expect, it } from "vitest";
import { listReceiverKeys, receiverKeyLabel, resolveReceiverKey, type ReceiverKeyVault } from "../key-store.js";

/** @file The receiver key lifecycle over an in-memory vault; the host binding pins the real credential store. */

const W = "ws-1";
const PREFIX = "Receiver key: ";
const KEY_A = "a".repeat(43);
const KEY_B = "b".repeat(43);

class DuplicateLabel extends Error {}

function memoryVault(overrides: Partial<ReceiverKeyVault> = {}) {
  const rows = new Map<string, { id: string; workspaceId: string; baseUrl: string; secret: string }>();
  let n = 0;
  const calls = { updates: 0, creates: 0 };
  const vault: ReceiverKeyVault = {
    listLabels: async ({ workspaceId }) => [...rows].filter(([, r]) => r.workspaceId === workspaceId).map(([label]) => label),
    resolve: async ({ workspaceId, label }) => { const r = rows.get(label); return r && r.workspaceId === workspaceId ? { id: r.id, baseUrl: r.baseUrl, secret: r.secret } : null; },
    create: async ({ workspaceId, label, baseUrl, secret }) => {
      if (rows.has(label)) throw new DuplicateLabel();
      calls.creates += 1; rows.set(label, { id: `cred-${++n}`, workspaceId, baseUrl, secret });
    },
    updateBaseUrl: async ({ id, baseUrl }) => { calls.updates += 1; for (const r of rows.values()) if (r.id === id) r.baseUrl = baseUrl; },
    isDuplicateLabel: (error) => error instanceof DuplicateLabel,
    ...overrides,
  };
  return { vault, rows, calls };
}

const keyFor = (vault: ReceiverKeyVault, scope: string, newSecret: () => string, workspaceId = W) => resolveReceiverKey({ vault, workspaceId, scope, labelPrefix: PREFIX, newSecret });
const queue = (...keys: string[]) => () => keys.shift()!;

describe("receiver key lifecycle", () => {
  it("labels a scope's key with the host's prefix", () => {
    expect(receiverKeyLabel({ labelPrefix: PREFIX, scope: "host-a" })).toBe("Receiver key: host-a");
  });

  it("a first publish mints a key and saves it only when told the published address", async () => {
    const { vault, rows } = memoryVault();
    const key = await keyFor(vault, "host-a", () => KEY_A);
    expect(key.secret).toBe(KEY_A);
    expect(rows.size).toBe(0);
    await key.save({ url: "https://site-a.example/some/path" });
    expect(rows.get("Receiver key: host-a")).toMatchObject({ secret: KEY_A, baseUrl: "https://site-a.example" });
  });

  it("a republish reuses the saved key and moves its address only when the published origin changed", async () => {
    const { vault, rows, calls } = memoryVault();
    await (await keyFor(vault, "host-a", () => KEY_A)).save({ url: "https://old.example" });
    const again = await keyFor(vault, "host-a", () => KEY_B);
    expect(again.secret).toBe(KEY_A);
    await again.save({ url: "https://old.example/" });
    expect(calls.updates).toBe(0);
    await again.save({ url: "https://renamed.example/" });
    expect(calls.updates).toBe(1);
    expect(rows.get("Receiver key: host-a")?.baseUrl).toBe("https://renamed.example");
  });

  it("a concurrent first save keeps the winner's key; other save failures propagate", async () => {
    const { vault, rows } = memoryVault();
    const next = queue(KEY_A, KEY_B);
    const first = await keyFor(vault, "host-a", next);
    const second = await keyFor(vault, "host-a", next);
    await first.save({ url: "https://a.example" });
    await second.save({ url: "https://a.example" });
    expect(rows.get("Receiver key: host-a")?.secret).toBe(KEY_A);
    const broken = memoryVault({ create: async () => { throw new Error("database is locked"); } });
    const failing = await keyFor(broken.vault, "host-a", () => KEY_A);
    await expect(failing.save({ url: "https://a.example" })).rejects.toThrow("database is locked");
  });
});

describe("listReceiverKeys", () => {
  it("returns the saved keys, optionally one scope's, with their published address", async () => {
    const { vault } = memoryVault();
    const next = queue(KEY_A, KEY_B);
    await (await keyFor(vault, "host-a", next)).save({ url: "https://a.example" });
    await (await keyFor(vault, "host-b", next)).save({ url: "https://b.example" });
    await vault.create({ workspaceId: W, label: "Unrelated credential", baseUrl: "https://x.example", secret: "x" });
    expect(await listReceiverKeys({ vault, workspaceId: W, labelPrefix: PREFIX })).toEqual([
      { scope: "host-a", destination: { url: "https://a.example", secret: KEY_A } },
      { scope: "host-b", destination: { url: "https://b.example", secret: KEY_B } },
    ]);
    const only = await listReceiverKeys({ vault, workspaceId: W, labelPrefix: PREFIX }, { scope: "host-b" });
    expect(only.map((entry) => entry.scope)).toEqual(["host-b"]);
    expect(await listReceiverKeys({ vault, workspaceId: "other", labelPrefix: PREFIX })).toEqual([]);
  });

  it("skips a label whose key cannot be opened", async () => {
    const { vault } = memoryVault({ listLabels: async () => [`${PREFIX}gone`], resolve: async () => null });
    expect(await listReceiverKeys({ vault, workspaceId: W, labelPrefix: PREFIX })).toEqual([]);
  });
});
