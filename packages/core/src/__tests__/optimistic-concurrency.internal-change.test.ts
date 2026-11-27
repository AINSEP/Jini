import { describe, expect, test } from "vitest";
import { applyInternalChange, RecordVersionConflictError } from "../optimistic-concurrency.js";

interface Row { readonly version: number; readonly label: string }

/** A one-row store whose conditional write can be made to lose a race a fixed number of times. */
function store(initial: Row | null, { losses = 0 }: { losses?: number } = {}) {
  let row = initial;
  let remainingLosses = losses;
  const writes: string[] = [];
  return {
    get row() { return row; },
    writes,
    read: async () => row,
    write: async ({ current, next }: { current: Row; next: Row }) => {
      if (remainingLosses > 0) { remainingLosses -= 1; row = { version: current.version + 1, label: "someone else" }; return false; }
      if (row?.version !== current.version) return false;
      row = { ...next, version: current.version + 1 };
      writes.push(next.label);
      return true;
    },
  };
}
const required = (s: ReturnType<typeof store>, build: (current: Row) => Promise<Row | null>) => ({ recordKind: "thing", recordId: "t1", read: s.read, build, write: s.write });

describe("applyInternalChange", () => {
  test("writes the built record against the version it read", async () => {
    const s = store({ version: 3, label: "a" });
    const written = await applyInternalChange(required(s, async (current) => ({ ...current, label: "b" })));
    expect(written?.label).toBe("b");
    expect(s.row).toEqual({ version: 4, label: "b" });
  });

  test("a miss re-reads and re-applies the same change once, on the fresh row", async () => {
    const s = store({ version: 1, label: "a" }, { losses: 1 });
    const seen: string[] = [];
    await applyInternalChange(required(s, async (current) => { seen.push(current.label); return { ...current, label: `${current.label}+change` }; }));
    expect(seen).toEqual(["a", "someone else"]);
    expect(s.row).toEqual({ version: 3, label: "someone else+change" });
  });

  test("two misses are a conflict naming the version the second attempt read and the live one", async () => {
    const s = store({ version: 1, label: "a" }, { losses: 2 });
    await expect(applyInternalChange(required(s, async (current) => ({ ...current, label: "b" })))).rejects.toMatchObject({
      name: "RecordVersionConflictError", recordKind: "thing", recordId: "t1", expectedVersion: 2, currentVersion: 3,
    });
    expect(s.writes).toEqual([]);
  });

  test("a missing record is null and nothing is written", async () => {
    const s = store(null);
    expect(await applyInternalChange(required(s, async (current) => current))).toBeNull();
  });

  test("a build with nothing to write returns null without a write", async () => {
    const s = store({ version: 1, label: "a" });
    expect(await applyInternalChange(required(s, async () => null))).toBeNull();
    expect(s.writes).toEqual([]);
  });

  test("a conflict is the shared error class", async () => {
    const s = store({ version: 1, label: "a" }, { losses: 2 });
    await expect(applyInternalChange(required(s, async (current) => current))).rejects.toBeInstanceOf(RecordVersionConflictError);
  });
});

test('reports a deleted record when both conditional writes miss and the final read finds no row', async () => {
  const s = store({ version: 4, label: 'old' }, { losses: 2 });
  let reads = 0;
  await expect(applyInternalChange({
    ...required(s, async (current) => ({ ...current, label: 'new' })),
    read: async () => ++reads === 3 ? null : s.read(),
  })).rejects.toMatchObject({
    name: 'RecordVersionConflictError', recordKind: 'thing', recordId: 't1', expectedVersion: 5, currentVersion: null,
  });
  expect(s.writes).toEqual([]);
});
