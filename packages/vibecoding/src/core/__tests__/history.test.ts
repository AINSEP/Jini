import { describe, expect, test } from "vitest";

import { applyEdits } from "../apply.js";
import { createEditHistory } from "../history.js";
import type { EditTarget } from "../target.js";
import type { PartId, Snapshot, ValidationResult } from "../types.js";

/**
 * The same in-memory host as `apply.test.ts`, plus a `validateCalls` counter — the undo path's
 * defining property is that it does *not* consult `validate`, and a counter is the only way to
 * assert an absence of calls rather than an absence of effects.
 */
function makeTarget(options?: {
  readonly initial?: Record<PartId, string>;
  readonly validate?: (candidate: { id: PartId; content: string }) => ValidationResult;
  readonly failWriteOn?: PartId;
}): EditTarget & { readonly parts: Map<PartId, string>; readonly validateCalls: PartId[] } {
  const parts = new Map<PartId, string>(Object.entries(options?.initial ?? {}));
  const validateCalls: PartId[] = [];

  return {
    parts,
    validateCalls,
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
    snapshot: async (): Promise<Snapshot> => ({ id: "snap", parts: Object.fromEntries(parts) }),
    restore: async (snapshot) => {
      parts.clear();
      for (const [id, content] of Object.entries(snapshot.parts)) parts.set(id, content);
    },
    validate: async (candidate) => {
      validateCalls.push(candidate.id);
      return options?.validate?.(candidate) ?? { ok: true };
    },
  };
}

describe("transaction batching", () => {
  test("a multi-part model turn undoes as ONE step, not as N steps", async () => {
    const target = makeTarget({ initial: { a: "a0", b: "b0", c: "c0" } });
    const history = createEditHistory(target);

    await history.transaction(
      (recording) =>
        applyEdits(recording, [
          { id: "a", content: "a1" },
          { id: "b", content: "b1" },
          { id: "c", content: "c1" },
        ]),
      "one turn"
    );

    expect(history.entries()).toHaveLength(1);

    await history.undo();

    expect(target.parts.get("a")).toBe("a0");
    expect(target.parts.get("b")).toBe("b0");
    expect(target.parts.get("c")).toBe("c0");
    expect(history.canUndo()).toBe(false);
  });

  test("the recording target is transparent — applyEdits still reports per-part outcomes through it", async () => {
    const target = makeTarget({
      initial: { a: "a0", b: "b0" },
      validate: (candidate) =>
        candidate.id === "b" ? { ok: false, reason: "unclosed <section>" } : { ok: true },
    });
    const history = createEditHistory(target);

    const outcomes = await history.transaction((recording) =>
      applyEdits(recording, [
        { id: "a", content: "a1" },
        { id: "b", content: "b1" },
      ])
    );

    expect(outcomes).toEqual([
      { status: "applied", id: "a" },
      { status: "rejected", id: "b", reason: "unclosed <section>" },
    ]);
    // Only the part that actually landed is undoable.
    expect(history.entries()[0]?.changes.map((c) => c.id)).toEqual(["a"]);
  });

  test("a transaction that changes nothing records no entry — a fully rejected turn leaves no empty step", async () => {
    const target = makeTarget({
      initial: { a: "a0" },
      validate: () => ({ ok: false, reason: "no" }),
    });
    const history = createEditHistory(target);

    await history.transaction((recording) => applyEdits(recording, [{ id: "a", content: "a1" }]));

    expect(history.entries()).toHaveLength(0);
    expect(history.canUndo()).toBe(false);
  });

  test("a write of identical content is not recorded as a step", async () => {
    const target = makeTarget({ initial: { a: "same" } });
    const history = createEditHistory(target);

    await history.transaction((recording) => applyEdits(recording, [{ id: "a", content: "same" }]));

    expect(history.canUndo()).toBe(false);
  });

  test("overlapping transactions are refused rather than silently interleaved", async () => {
    const target = makeTarget({ initial: { a: "a0" } });
    const history = createEditHistory(target);

    await expect(
      history.transaction(async () => {
        await history.transaction(async () => undefined);
      })
    ).rejects.toThrow(/already open/);
  });
});

describe("undo and redo", () => {
  test("redo re-applies what undo reverted", async () => {
    const target = makeTarget({ initial: { a: "a0" } });
    const history = createEditHistory(target);

    await history.transaction((r) => applyEdits(r, [{ id: "a", content: "a1" }]));
    await history.undo();
    expect(target.parts.get("a")).toBe("a0");

    await history.redo();

    expect(target.parts.get("a")).toBe("a1");
    expect(history.canUndo()).toBe(true);
    expect(history.canRedo()).toBe(false);
  });

  test("undo steps back one transaction at a time, in reverse order", async () => {
    const target = makeTarget({ initial: { a: "a0" } });
    const history = createEditHistory(target);

    await history.transaction((r) => applyEdits(r, [{ id: "a", content: "a1" }]));
    await history.transaction((r) => applyEdits(r, [{ id: "a", content: "a2" }]));

    await history.undo();
    expect(target.parts.get("a")).toBe("a1");
    await history.undo();
    expect(target.parts.get("a")).toBe("a0");
  });

  test("undo and redo do NOT consult validate — a multi-part rewind must not be judged on its intermediate states", async () => {
    const target = makeTarget({ initial: { a: "a0", b: "b0" } });
    const history = createEditHistory(target);

    await history.transaction((r) =>
      applyEdits(r, [
        { id: "a", content: "a1" },
        { id: "b", content: "b1" },
      ])
    );
    const callsAfterApply = target.validateCalls.length;
    expect(callsAfterApply).toBe(2);

    await history.undo();
    await history.redo();

    expect(target.validateCalls.length).toBe(callsAfterApply);
  });

  test("a rewind survives a validate that refuses everything — the state was already committed once", async () => {
    let hostile = false;
    const target = makeTarget({
      initial: { a: "a0" },
      validate: () => (hostile ? { ok: false, reason: "everything is invalid now" } : { ok: true }),
    });
    const history = createEditHistory(target);
    await history.transaction((r) => applyEdits(r, [{ id: "a", content: "a1" }]));

    // The host turns hostile after the fact — a rewind must not be at its mercy.
    hostile = true;

    await expect(history.undo()).resolves.not.toBeNull();
    expect(target.parts.get("a")).toBe("a0");
  });

  test("committing a new transaction clears the redo stack", async () => {
    const target = makeTarget({ initial: { a: "a0" } });
    const history = createEditHistory(target);

    await history.transaction((r) => applyEdits(r, [{ id: "a", content: "a1" }]));
    await history.undo();
    expect(history.canRedo()).toBe(true);

    await history.transaction((r) => applyEdits(r, [{ id: "a", content: "branched" }]));

    expect(history.canRedo()).toBe(false);
  });

  test("undo and redo on empty stacks return null rather than throwing", async () => {
    const history = createEditHistory(makeTarget());

    await expect(history.undo()).resolves.toBeNull();
    await expect(history.redo()).resolves.toBeNull();
  });
});

describe("creation — the case undo cannot fully invert", () => {
  test("undoing a created part writes empty content and flags existedBefore:false", async () => {
    const target = makeTarget();
    const history = createEditHistory(target);

    await history.transaction((r) => applyEdits(r, [{ id: "fresh", content: "hello" }]));

    expect(history.entries()[0]?.changes[0]).toEqual({
      id: "fresh",
      before: "",
      after: "hello",
      existedBefore: false,
    });

    await history.undo();

    // No delete verb exists on EditTarget, so the part remains — emptied, not removed. A host with
    // its own delete capability reads `existedBefore` to finish the job.
    expect(target.parts.has("fresh")).toBe(true);
    expect(target.parts.get("fresh")).toBe("");
  });
});

describe("never-destructive restore", () => {
  test("a snapshot restore is itself undoable", async () => {
    const target = makeTarget({ initial: { a: "a0", b: "b0" } });
    const history = createEditHistory(target);
    const snapshot = await target.snapshot();

    await history.transaction((r) =>
      applyEdits(r, [
        { id: "a", content: "a-edited" },
        { id: "b", content: "b-edited" },
      ])
    );

    await history.restore(snapshot);
    expect(target.parts.get("a")).toBe("a0");
    expect(target.parts.get("b")).toBe("b0");

    // The rewind was a step like any other — stepping back returns the edited state.
    await history.undo();
    expect(target.parts.get("a")).toBe("a-edited");
    expect(target.parts.get("b")).toBe("b-edited");
  });

  test("restoring a snapshot that already matches records nothing", async () => {
    const target = makeTarget({ initial: { a: "a0" } });
    const history = createEditHistory(target);

    const entry = await history.restore(await target.snapshot());

    expect(entry).toBeNull();
    expect(history.canUndo()).toBe(false);
  });

  test("restore leaves parts absent from the snapshot alone — there is no delete verb", async () => {
    const target = makeTarget({ initial: { a: "a0" } });
    const history = createEditHistory(target);
    const snapshot = await target.snapshot();

    await history.transaction((r) => applyEdits(r, [{ id: "added-later", content: "extra" }]));
    await history.restore(snapshot);

    expect(target.parts.get("a")).toBe("a0");
    expect(target.parts.get("added-later")).toBe("extra");
  });
});

describe("durability of the stack itself", () => {
  test("a transaction that throws still commits its partial changes as an undoable entry", async () => {
    const target = makeTarget({ initial: { a: "a0" } });
    const history = createEditHistory(target);

    await expect(
      history.transaction(async (recording) => {
        await recording.replacePart("a", "a1");
        throw new Error("model turn exploded");
      })
    ).rejects.toThrow("model turn exploded");

    expect(history.canUndo()).toBe(true);
    await history.undo();
    expect(target.parts.get("a")).toBe("a0");
  });

  /**
   * The same principle the test above pins for `transaction`, applied to the three replay paths.
   * `makeTarget`'s `failWriteOn` switch is fixed at construction, which cannot express these cases:
   * the fault has to land on a REPLAY write, after a clean transaction has already been recorded.
   */
  function armFailureOn(target: EditTarget, id: PartId): void {
    const real = target.replacePart;
    target.replacePart = async (partId, content) => {
      if (partId === id) throw new Error("disk on fire");
      await real(partId, content);
    };
  }

  test("an undo that fails partway keeps its entry on the undo stack, so the half-rewound artifact is still reachable", async () => {
    const target = makeTarget({ initial: { a: "a0", b: "b0" } });
    const history = createEditHistory(target);
    await history.transaction((recording) =>
      applyEdits(recording, [
        { id: "a", content: "a1" },
        { id: "b", content: "b1" },
      ])
    );

    // Undo replays in reverse, so `b` rewinds cleanly and `a` is the one that blows up.
    armFailureOn(target, "a");
    await expect(history.undo()).rejects.toThrow("disk on fire");

    expect(target.parts.get("b")).toBe("b0");
    expect(target.parts.get("a")).toBe("a1");
    // Stranded in neither stack was the defect: the entry must still be undoable, and must NOT
    // have moved to redo, because the state redo would move toward is the state still on disk.
    expect(history.canUndo()).toBe(true);
    expect(history.canRedo()).toBe(false);

    // Retrying finishes the job — replaying `before` over the part that already rewound rewrites
    // it with the content it already holds, which is what makes the retry safe, not merely possible.
    target.replacePart = async (id, content) => {
      target.parts.set(id, content);
    };
    await history.undo();
    expect(target.parts.get("a")).toBe("a0");
    expect(target.parts.get("b")).toBe("b0");
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(true);
  });

  test("a redo that fails partway keeps its entry on the redo stack", async () => {
    const target = makeTarget({ initial: { a: "a0", b: "b0" } });
    const history = createEditHistory(target);
    await history.transaction((recording) =>
      applyEdits(recording, [
        { id: "a", content: "a1" },
        { id: "b", content: "b1" },
      ])
    );
    await history.undo();

    // Redo replays in application order, so `b` is the second write here.
    armFailureOn(target, "b");
    await expect(history.redo()).rejects.toThrow("disk on fire");

    expect(target.parts.get("a")).toBe("a1");
    expect(target.parts.get("b")).toBe("b0");
    expect(history.canRedo()).toBe(true);
    expect(history.canUndo()).toBe(false);
  });

  test("a restore that fails partway still records its entry, so the parts it did change can be undone", async () => {
    const target = makeTarget({ initial: { a: "a0", b: "b0" } });
    const history = createEditHistory(target);
    const snapshot: Snapshot = { id: "snap", parts: { a: "aX", b: "bX" } };

    armFailureOn(target, "b");
    await expect(history.restore(snapshot)).rejects.toThrow("disk on fire");

    expect(target.parts.get("a")).toBe("aX");
    expect(target.parts.get("b")).toBe("b0");
    // Without a recorded entry the write to `a` would be unreachable through this API — exactly
    // the destructive-restore failure this tier exists to prevent, reached by a different route.
    expect(history.canUndo()).toBe(true);

    target.replacePart = async (id, content) => {
      target.parts.set(id, content);
    };
    await history.undo();
    expect(target.parts.get("a")).toBe("a0");
    expect(target.parts.get("b")).toBe("b0");
  });

  test("the stack is bounded — oldest entries drop past the limit", async () => {
    const target = makeTarget({ initial: { a: "a0" } });
    const history = createEditHistory(target, { limit: 2 });

    for (const content of ["a1", "a2", "a3"]) {
      await history.transaction((r) => applyEdits(r, [{ id: "a", content }]), content);
    }

    expect(history.entries().map((e) => e.label)).toEqual(["a2", "a3"]);
  });

  test("entries() returns a copy — mutating it cannot corrupt the stack", async () => {
    const target = makeTarget({ initial: { a: "a0" } });
    const history = createEditHistory(target);
    await history.transaction((r) => applyEdits(r, [{ id: "a", content: "a1" }]));

    (history.entries() as unknown[]).length = 0;

    expect(history.entries()).toHaveLength(1);
  });

  test("clear discards both stacks", async () => {
    const target = makeTarget({ initial: { a: "a0" } });
    const history = createEditHistory(target);
    await history.transaction((r) => applyEdits(r, [{ id: "a", content: "a1" }]));
    await history.undo();

    history.clear();

    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
  });
});
