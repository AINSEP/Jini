import assert from "node:assert/strict";
import { test } from "vitest";
import { reviewedWriteScope, runReviewedThemeFileWrite, type ReviewedThemeFile } from "../reviewed-write.node.js";

function prepared({ name }: { name: string }): ReviewedThemeFile {
  return { file: { themeDir: "/themes/copy", themesRoot: "/themes", relativePath: name }, target: `/themes/copy/${name}`, version: `reviewed-${name}` };
}

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

// Mutation: force a default committed value even when no writer recorded one.
test("a handler that writes nothing returns its result and no committed version", async () => {
  const file = prepared({ name: "unchanged.css" });
  const value = { unchanged: true };
  const outcome = await runReviewedThemeFileWrite({ prepared: file, run: async () => {
    assert.equal(reviewedWriteScope()?.prepared, file);
    return value;
  } });
  assert.equal(outcome.result, value);
  assert.equal(outcome.committedVersion, undefined);
  assert.equal(reviewedWriteScope({}, {}), undefined);
});

// Mutation: swallow or replace the original rejection.
test("handler rejection propagates by identity and leaves no scope", async () => {
  const failure = new Error("fixture rejection");
  await assert.rejects(runReviewedThemeFileWrite({ prepared: prepared({ name: "refused.css" }), run: async () => { throw failure; } }), error => error === failure);
  assert.equal(reviewedWriteScope(), undefined);
});

// Mutation: replace async-local storage with one shared mutable scope.
test("overlapping handlers see only their own prepared file and committed version", async () => {
  const firstPrepared = prepared({ name: "first.css" }), secondPrepared = prepared({ name: "second.css" });
  const firstEntered = gate(), secondEntered = gate(), releaseFirst = gate(), releaseSecond = gate();
  const first = runReviewedThemeFileWrite({ prepared: firstPrepared, run: async () => {
    const scope = reviewedWriteScope();
    assert.ok(scope);
    assert.equal(scope.prepared, firstPrepared);
    firstEntered.resolve();
    await releaseFirst.promise;
    assert.equal(reviewedWriteScope(), scope);
    assert.equal(reviewedWriteScope()?.prepared, firstPrepared);
    scope.committed = "first-commit";
    return { first: 1 };
  } });
  await firstEntered.promise;
  const second = runReviewedThemeFileWrite({ prepared: secondPrepared, run: async () => {
    const scope = reviewedWriteScope();
    assert.ok(scope);
    assert.equal(scope.prepared, secondPrepared);
    secondEntered.resolve();
    await releaseSecond.promise;
    assert.equal(reviewedWriteScope(), scope);
    assert.equal(reviewedWriteScope()?.prepared, secondPrepared);
    scope.committed = "second-commit";
    return { second: 2 };
  } });
  await secondEntered.promise;
  releaseSecond.resolve();
  assert.deepEqual(await second, { result: { second: 2 }, committedVersion: "second-commit" });
  releaseFirst.resolve();
  assert.deepEqual(await first, { result: { first: 1 }, committedVersion: "first-commit" });
  assert.equal(reviewedWriteScope(), undefined);
});
