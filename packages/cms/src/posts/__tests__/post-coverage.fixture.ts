import type { DomainEvent, OutboxPort } from "@jini-ai/core/contracts/events";
import { createHash } from "node:crypto";
import { createMediaAccessEvidence } from "../../media/site/access-evidence.js";
import { bindInMemoryPostRepo } from "../repo.memory.js";
import type { RemovePostFn } from "../post-trash.js";
import type { PostRecord } from "../post.js";

export const NOW = "2026-11-25T12:00:00.000Z";
export const WORKSPACE = "newsroom";
export const postClock = { nowMs: () => Date.parse(NOW) };

export function postRow(fields: Partial<PostRecord> = {}): PostRecord {
  return {
    id: "post-id", workspaceId: WORKSPACE, kind: "post", title: "Default article", slug: "default-article",
    status: "draft", version: 4, updatedAt: "2026-11-24T12:00:00.000Z", bodyFormat: "doc",
    bodyHtml: null, bodyJson: { type: "doc", content: [] }, ...fields,
  };
}

export function postRepo(initialRows: PostRecord[] = []) {
  let nextRevision = 0;
  const Repo = bindInMemoryPostRepo({
    nowIso: () => NOW, newId: () => `revision-${++nextRevision}`, createEvidence: createMediaAccessEvidence,
    hashJsonText: text => createHash("sha256").update(text).digest("hex"),
  });
  return new Repo({}, { initialRows });
}


export function recordingPostOutbox() {
  const events: DomainEvent[] = [];
  const outbox: OutboxPort = {
    async enqueue(event) { events.push(event); },
    async claimPending() { return []; },
    async markDelivered() {},
    async markFailed() {},
  };
  return { events, outbox };
}


/** Stand-in for the host's conditional trash marker. The real repo owns the saved row. */
export function removeFromPostRepo(repo: ReturnType<typeof postRepo>): RemovePostFn {
  return async ({ workspaceId, id, expectedVersion, at }) => {
    const row = await repo.findById({ workspaceId, id });
    if (!row || row.deletedAt) return { ok: false, reason: "not-found" };
    if (expectedVersion !== null && row.version !== expectedVersion) return { ok: false, reason: "version-changed" };
    const version = row.version + 1;
    await repo.softDelete({ workspaceId, id, deletedAt: at, updatedAt: at, version });
    return { ok: true, version };
  };
}
