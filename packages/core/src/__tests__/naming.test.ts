import assert from "node:assert/strict";
import { test } from "vitest";

import { deriveAvailableName as availableName, deriveDuplicateName as duplicateName, MAX_SUFFIX_ATTEMPTS } from "../naming.js";

const copyPolicy = {
  withSuffix: ({ base, suffix }: { base: string; suffix: number }) => `${base} ${suffix}`,
  exhaustionMessage: ({ base, maxAttempts }: { base: string; maxAttempts: number }) =>
    `no free name could be derived from '${base}' after ${maxAttempts} attempts — give the copy an explicit name`,
};
function deriveAvailableName(required: { base: string }, options: {
  isTaken: (candidate: string) => Promise<boolean>;
  withSuffix?: (base: string, suffix: number) => string;
  onExhausted?: (required: { base: string; maxAttempts: number }) => never;
}) {
  const { isTaken, withSuffix, ...optional } = options;
  return availableName({
    ...required, ...copyPolicy,
    isTaken: ({ candidate }) => isTaken(candidate),
    withSuffix: withSuffix ? ({ base, suffix }) => withSuffix(base, suffix) : copyPolicy.withSuffix,
  }, optional);
}
function deriveDuplicateName(required: { sourceName: string }, options: { isTaken: (candidate: string) => Promise<boolean> }) {
  return duplicateName({ ...required, ...copyPolicy, isTaken: ({ candidate }) => options.isTaken(candidate) });
}

test('required naming policy and optional bound support host-specific wording and suffixes', async () => {
  const policy = {
    isTaken: async ({ candidate }: { candidate: string }) => candidate === 'item',
    withSuffix: ({ base, suffix }: { base: string; suffix: number }) => `${base}-${suffix}`,
    exhaustionMessage: ({ maxAttempts }: { maxAttempts: number }) => `Naming limit ${maxAttempts}`,
  };
  assert.equal(await availableName({ base: 'item', ...policy }, { maxAttempts: 2 }), 'item-2');
  await assert.rejects(availableName({ base: 'item', ...policy }, { maxAttempts: 1 }), { message: 'Naming limit 1' });
  for (const maxAttempts of [0, -1, 1.5, NaN, Infinity]) {
    await assert.rejects(availableName({ base: 'item', ...policy }, { maxAttempts }), RangeError);
  }
});

test('copy search never returns the source even when the predicate omits it', async () => {
  assert.equal(await duplicateName({ sourceName: 'item', ...copyPolicy, isTaken: async () => false }), 'item 2');
});
function neverTaken() {
  return async () => false;
}

function takenSet(...names: string[]) {
  const taken = new Set(names);
  return async (name: string) => taken.has(name);
}

// ---------------------------------------------------------------------------------------------
// deriveAvailableName — the generic loop.
// ---------------------------------------------------------------------------------------------

test("deriveAvailableName returns the base unmodified when it is free", async () => {
  assert.equal(await deriveAvailableName({ base: "Landing" }, { isTaken: neverTaken() }), "Landing");
});

test("deriveAvailableName defaults to a space-separated numeric suffix, skipping every taken candidate", async () => {
  const isTaken = takenSet("Landing", "Landing 2", "Landing 3");
  assert.equal(await deriveAvailableName({ base: "Landing" }, { isTaken }), "Landing 4");
});

test("deriveAvailableName uses a custom withSuffix instead of the default when one is given", async () => {
  const isTaken = takenSet("post");
  const withSuffix = (base: string, suffix: number) => `${base}-${suffix}`;
  assert.equal(await deriveAvailableName({ base: "post" }, { isTaken, withSuffix }), "post-2");
});

test("deriveAvailableName gives up after MAX_SUFFIX_ATTEMPTS rather than looping forever", async () => {
  const attempted: string[] = [];
  await assert.rejects(
    deriveAvailableName({ base: "x" }, { isTaken: async (candidate) => { attempted.push(candidate); return true; } }),
    new RegExp(`no free name.*after ${MAX_SUFFIX_ATTEMPTS} attempts`),
  );
  assert.deepEqual(attempted, ["x", ...Array.from({ length: 999 }, (_, i) => `x ${i + 2}`)]);
});

test("deriveAvailableName calls onExhausted instead of the generic error when every candidate is taken", async () => {
  await assert.rejects(
    deriveAvailableName(
      { base: "x" },
      {
        isTaken: async () => true,
        onExhausted: () => {
          throw new Error("custom exhaustion message");
        },
      },
    ),
    /custom exhaustion message/,
  );
});

// ---------------------------------------------------------------------------------------------
// deriveDuplicateName — the trailing-number rule.
// ---------------------------------------------------------------------------------------------

test("a name with no trailing number starts its search at ' 2' (the source itself is always taken)", async () => {
  const isTaken = takenSet("Landing sample — xai");
  assert.equal(
    await deriveDuplicateName({ sourceName: "Landing sample — xai" }, { isTaken }),
    "Landing sample — xai 2",
  );
});

test("copying the same source repeatedly increments: '... 2', then '... 3'", async () => {
  const taken = new Set(["Landing sample — xai"]);
  const isTaken = async (name: string) => taken.has(name);

  const first = await deriveDuplicateName({ sourceName: "Landing sample — xai" }, { isTaken });
  taken.add(first);
  const second = await deriveDuplicateName({ sourceName: "Landing sample — xai" }, { isTaken });

  assert.equal(first, "Landing sample — xai 2");
  assert.equal(second, "Landing sample — xai 3");
});

test("a trailing number IS treated as an existing copy counter when the stripped base exists — 'Landing 2' increments to 'Landing 3' only if 'Landing' exists", async () => {
  const isTaken = takenSet("Landing", "Landing 2");
  assert.equal(await deriveDuplicateName({ sourceName: "Landing 2" }, { isTaken }), "Landing 3");
});

test("a trailing number is NOT treated as a copy counter when the stripped base does not exist — 'Blog 2024' becomes 'Blog 2024 2', not 'Blog 2025'", async () => {
  const isTaken = takenSet("Blog 2024");
  assert.equal(await deriveDuplicateName({ sourceName: "Blog 2024" }, { isTaken }), "Blog 2024 2");
});

test("a bare number with nothing to strip is treated as a literal name, not a counter", async () => {
  const isTaken = takenSet("2024");
  assert.equal(await deriveDuplicateName({ sourceName: "2024" }, { isTaken }), "2024 2");
});

test("deriveAvailableName succeeds on the final permitted candidate", async () => {
  const attempted: string[] = [];
  const result = await deriveAvailableName({ base: "x" }, { isTaken: async (candidate) => {
    attempted.push(candidate);
    return candidate !== "x 1000";
  } });
  assert.equal(result, "x 1000");
  assert.deepEqual(attempted, ["x", ...Array.from({ length: 999 }, (_, i) => `x ${i + 2}`)]);
});
