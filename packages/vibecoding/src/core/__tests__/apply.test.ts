import { describe, expect, test } from "vitest";

import { applyEdit, applyEdits, correctionsFor } from "../apply.js";
import type { EditTarget } from "../target.js";
import type { PartId, Snapshot, ValidationResult } from "../types.js";

/**
 * A minimal in-memory target standing in for a real host. Two knobs matter for these tests: a
 * pluggable `validate`, and an optional write that throws — the two branches a host cannot
 * exercise through the happy path.
 */
function makeTarget(options?: {
  readonly initial?: Record<PartId, string>;
  readonly validate?: (candidate: { id: PartId; content: string }) => ValidationResult;
  readonly failWriteOn?: PartId;
}): EditTarget & { readonly parts: Map<PartId, string> } {
  const parts = new Map<PartId, string>(Object.entries(options?.initial ?? {}));

  return {
    parts,
    listParts: async () => [...parts.keys()].map((id) => ({ id })),
    readPart: async (id) => {
      const found = parts.get(id);
      if (found === undefined) throw new Error(`no such part: ${id}`);
      return found;
    },
    replacePart: async (id, content) => {
      if (options?.failWriteOn === id) throw new Error("disk on fire");
      parts.set(id, content);
    },
    snapshot: async (): Promise<Snapshot> => ({
      id: "snap",
      parts: Object.fromEntries(parts),
    }),
    restore: async (snapshot) => {
      parts.clear();
      for (const [id, content] of Object.entries(snapshot.parts)) parts.set(id, content);
    },
    validate: async (candidate) => options?.validate?.(candidate) ?? { ok: true },
  };
}

describe("applyEdit", () => {
  test("commits when the host validates the change", async () => {
    const target = makeTarget({ initial: { a: "old" } });

    const outcome = await applyEdit(target, { id: "a", content: "new" });

    expect(outcome).toEqual({ status: "applied", id: "a" });
    expect(target.parts.get("a")).toBe("new");
  });

  test("replace is an upsert — a part that did not exist is created", async () => {
    const target = makeTarget();

    const outcome = await applyEdit(target, { id: "fresh", content: "hello" });

    expect(outcome.status).toBe("applied");
    expect(target.parts.get("fresh")).toBe("hello");
  });

  test("a rejected edit is NOT written, and carries the host's reason", async () => {
    const target = makeTarget({
      initial: { a: "old" },
      validate: () => ({ ok: false, reason: "unclosed <section>" }),
    });

    const outcome = await applyEdit(target, { id: "a", content: "<section>" });

    expect(outcome).toEqual({ status: "rejected", id: "a", reason: "unclosed <section>" });
    // The critical assertion: rejection must leave the artifact untouched.
    expect(target.parts.get("a")).toBe("old");
  });

  test("validate sees the proposed content, not the current content", async () => {
    const seen: string[] = [];
    const target = makeTarget({
      initial: { a: "old" },
      validate: (candidate) => {
        seen.push(candidate.content);
        return { ok: true };
      },
    });

    await applyEdit(target, { id: "a", content: "proposed" });

    expect(seen).toEqual(["proposed"]);
  });

  test("a write failure surfaces as `failed` rather than being swallowed", async () => {
    const target = makeTarget({ initial: { a: "old" }, failWriteOn: "a" });

    const outcome = await applyEdit(target, { id: "a", content: "new" });

    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") throw new Error("unreachable");
    expect(outcome.error.message).toBe("disk on fire");
  });
});

describe("applyEdits", () => {
  test("returns one outcome per proposal, positionally aligned", async () => {
    const target = makeTarget();

    const outcomes = await applyEdits(target, [
      { id: "a", content: "1" },
      { id: "b", content: "2" },
    ]);

    expect(outcomes.map((o) => o.status)).toEqual(["applied", "applied"]);
    expect(outcomes.map((o) => o.id)).toEqual(["a", "b"]);
  });

  test("a rejected edit does not halt the batch", async () => {
    const target = makeTarget({
      validate: (candidate) =>
        candidate.id === "bad" ? { ok: false, reason: "nope" } : { ok: true },
    });

    const outcomes = await applyEdits(target, [
      { id: "bad", content: "x" },
      { id: "good", content: "y" },
    ]);

    expect(outcomes.map((o) => o.status)).toEqual(["rejected", "applied"]);
    expect(target.parts.get("good")).toBe("y");
    expect(target.parts.has("bad")).toBe(false);
  });

  test("edits apply in the given order", async () => {
    const target = makeTarget();

    await applyEdits(target, [
      { id: "a", content: "first" },
      { id: "a", content: "second" },
    ]);

    expect(target.parts.get("a")).toBe("second");
  });
});

describe("correctionsFor", () => {
  test("surfaces rejections and failures, and nothing else", async () => {
    const target = makeTarget({
      failWriteOn: "boom",
      validate: (candidate) =>
        candidate.id === "bad" ? { ok: false, reason: "unclosed tag" } : { ok: true },
    });

    const outcomes = await applyEdits(target, [
      { id: "fine", content: "ok" },
      { id: "bad", content: "x" },
      { id: "boom", content: "y" },
    ]);

    expect(correctionsFor(outcomes)).toEqual([
      { id: "bad", reason: "unclosed tag" },
      { id: "boom", reason: "disk on fire" },
    ]);
  });

  test("an all-applied batch produces no corrections", async () => {
    const target = makeTarget();
    const outcomes = await applyEdits(target, [{ id: "a", content: "1" }]);

    expect(correctionsFor(outcomes)).toEqual([]);
  });
});

describe("snapshot / restore", () => {
  test("restore returns the artifact to captured content, dropping later parts", async () => {
    const target = makeTarget({ initial: { a: "original" } });
    const snap = await target.snapshot();

    await applyEdits(target, [
      { id: "a", content: "edited" },
      { id: "added-later", content: "new part" },
    ]);
    expect(target.parts.get("a")).toBe("edited");

    await target.restore(snap);

    expect(target.parts.get("a")).toBe("original");
    expect(target.parts.has("added-later")).toBe(false);
  });
});
