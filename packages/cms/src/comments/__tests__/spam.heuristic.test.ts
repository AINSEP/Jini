import assert from "node:assert/strict";
import { test } from "vitest";

import { HeuristicSpamCheck } from "../spam.heuristic.js";
import type { CommentSubmission } from "../types.js";
import type { SpamCheckPort } from "../ports.js";

function submission(overrides: Partial<CommentSubmission> = {}): CommentSubmission {
  return {
    workspaceId: "workspace-1",
    entryId: "entry-1",
    parentId: null,
    authorName: "Visitor",
    authorEmail: null,
    authorUrl: null,
    bodyRaw: "This is a normal, thoughtful comment about the article.",
    authorPrincipalId: null,
    ingressContext: {},
    ...overrides,
  };
}

test("a normal comment scores low and is not flagged as spam", async () => {
  const check = new HeuristicSpamCheck();
  const verdict = await check.check(submission());
  assert.equal(verdict.isSpam, false);
  assert.ok(verdict.score < 0.5);
  assert.equal(verdict.provider, "heuristic");
});

test("a link-heavy body scores high", async () => {
  const check = new HeuristicSpamCheck();
  const verdict = await check.check(
    submission({ bodyRaw: "check https://a.com https://b.com https://c.com https://d.com" })
  );
  assert.equal(verdict.score, 0.6);
  assert.equal(verdict.isSpam, true);
});

test("a body with spam keywords scores high and is flagged", async () => {
  const check = new HeuristicSpamCheck();
  const verdict = await check.check(submission({ bodyRaw: "buy cheap viagra and cialis now, click here now" }));
  assert.equal(verdict.isSpam, true);
  assert.ok(verdict.score >= 0.5);
});

test("a short body with a link scores higher than the same short body without one", async () => {
  const check = new HeuristicSpamCheck();
  const withoutLink = await check.check(submission({ bodyRaw: "nice!" }));
  const withLink = await check.check(submission({ bodyRaw: "nice! https://x.com" }));
  assert.ok(withLink.score > withoutLink.score);
});

test("report() is a documented no-op that does not throw", async () => {
  // Typed as the port: callers reach report() through SpamCheckPort, whose signature takes the input.
  const check: SpamCheckPort = new HeuristicSpamCheck();
  await assert.doesNotReject(() =>
    check.report!({
      workspaceId: "workspace-1",
      comment: {} as never,
      verdict: "spam",
    })
  );
});

test("long bodies add risk only beyond 4000 characters and only with a link or spam keyword", async () => {
  const check = new HeuristicSpamCheck();
  for (const signal of ["", "https://x.com ", "casino "]) {
    const atThreshold = signal + "x".repeat(4000 - signal.length);
    const before = await check.check(submission({ bodyRaw: atThreshold }));
    const after = await check.check(submission({ bodyRaw: atThreshold + "x" }));
    const baseScore = signal === "casino " ? 0.35 : 0;
    assert.equal(before.score, baseScore);
    assert.equal(after.score, signal ? baseScore + 0.2 : 0);
    assert.equal(before.isSpam, false);
    assert.equal(after.isSpam, signal === "casino ");
  }
});
