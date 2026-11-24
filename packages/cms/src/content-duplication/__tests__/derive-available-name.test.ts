import assert from "node:assert/strict";
import { test } from "vitest";

import { deriveAvailableName, deriveDuplicateName, MAX_SUFFIX_ATTEMPTS } from "../derive-available-name.js";

/**
 * @file Certifies the shared collision-search loop (`deriveAvailableName`) and the
 * `content_duplicate` naming policy built on top of it (`deriveDuplicateName`) — the module the
 * host's post, form and media duplicate tools all call for their DEFAULT copy title/name, and its
 * form-slug search delegates to.
 *
 * `deriveDuplicateName`'s trailing-number rule is the load-bearing, easy-to-get-wrong case: whether a
 * trailing integer on the source's own name is read as an existing copy counter (and stripped before
 * searching) depends on whether the STRIPPED base exists as a name in the resource — never on the
 * number's own magnitude. Both branches are asserted directly below, not just the common case.
 */

function neverTaken() {
  return async () => false;
}

function takenSet(...names: string[]) {
  const taken = new Set(names);
  return async ({ candidate }: { candidate: string }) => taken.has(candidate);
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
    deriveAvailableName({ base: "x" }, { isTaken: async ({ candidate }) => { attempted.push(candidate); return true; } }),
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
  const isTaken = async ({ candidate }: { candidate: string }) => taken.has(candidate);

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
  const result = await deriveAvailableName({ base: "x" }, { isTaken: async ({ candidate }) => {
    attempted.push(candidate);
    return candidate !== "x 1000";
  } });
  assert.equal(result, "x 1000");
  assert.deepEqual(attempted, ["x", ...Array.from({ length: 999 }, (_, i) => `x ${i + 2}`)]);
});
