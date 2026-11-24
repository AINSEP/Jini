import assert from "node:assert/strict";
import { test } from "vitest";

import { memberChallengeStore } from "../member-challenge.js";
import { InMemoryMagicLinkTokenRepo } from "../repo.memory.js";
import { MagicLinkTokenRejectedError } from "../types.js";

const WORKSPACE_ID = "ws-1";
const CREATED = "2026-01-01T00:00:00.000Z";
const consumeInput = { workspaceId: WORKSPACE_ID, realm: "member", purpose: "signin", id: "c-1", nowIso: "2026-01-01T00:05:00.000Z" } as const;

async function seededRepo(expiresAt = "2026-01-01T00:15:00.000Z"): Promise<InMemoryMagicLinkTokenRepo> {
  const repo = new InMemoryMagicLinkTokenRepo();
  await repo.save({ id: "c-1", workspaceId: WORKSPACE_ID, memberId: "m-1", email: "a@example.com", purpose: "signin", tokenHash: "h", failedAttempts: 0, createdAt: CREATED, expiresAt });
  return repo;
}

test("B189: the repo refuses a missing, expired or already used token with a typed error carrying the reason", async () => {
  const repo = await seededRepo();
  await assert.rejects(repo.consume({ workspaceId: WORKSPACE_ID, id: "nope", consumedAt: consumeInput.nowIso }),
    (error) => error instanceof MagicLinkTokenRejectedError && error.reason === "not_found");
  const expired = await seededRepo("2026-01-01T00:01:00.000Z");
  await assert.rejects(expired.consume({ workspaceId: WORKSPACE_ID, id: "c-1", consumedAt: consumeInput.nowIso }),
    (error) => error instanceof MagicLinkTokenRejectedError && error.reason === "expired");
  await repo.consume({ workspaceId: WORKSPACE_ID, id: "c-1", consumedAt: consumeInput.nowIso });
  await assert.rejects(repo.consume({ workspaceId: WORKSPACE_ID, id: "c-1", consumedAt: consumeInput.nowIso }),
    (error) => error instanceof MagicLinkTokenRejectedError && error.reason === "already_consumed");
});

for (const reason of ["not_found", "expired", "already_consumed"] as const) {
  test(`B189: the challenge store maps the typed ${reason} rejection to false`, async () => {
    const repo = await seededRepo();
    repo.consume = async () => { throw new MagicLinkTokenRejectedError({ id: "c-1", reason }); };
    assert.equal(await memberChallengeStore({ repo }).consume(consumeInput), false);
  });
}

test("B189: an ordinary error that merely reads like a rejection is not swallowed", async () => {
  const repo = await seededRepo();
  repo.consume = async () => { throw new Error("magic link token 'c-1' was already consumed"); };
  await assert.rejects(memberChallengeStore({ repo }).consume(consumeInput), /already consumed/);
});
