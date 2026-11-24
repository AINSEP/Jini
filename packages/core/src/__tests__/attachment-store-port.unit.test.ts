import assert from "node:assert/strict";
import { expectTypeOf, test } from "vitest";

import type { AttachmentClaim, AttachmentStore, PendingAttachmentSummary, StoredAttachment } from "../contracts/site/daemon-http.js";

/**
 * @file Pins the run-attachment lookup port this package owns (`AttachmentStore` / `AttachmentClaim`,
 * moved from `@jini-ai/daemon/http`). A domain package types its lookup as a `Pick` of the port and
 * satisfies it from a hand-written fake, so the shape of `resolveForRun` and the assignability of that
 * `Pick` are the contract: a drift fails `tsc`, and the runtime assertion proves the fake is callable.
 */
type ChatAttachmentLookup = Pick<AttachmentStore, "resolveForRun">;

test("resolveForRun takes a named { ref, runId } and resolves a StoredAttachment or undefined", () => {
  expectTypeOf<Parameters<AttachmentStore["resolveForRun"]>[0]>().toEqualTypeOf<{ readonly ref: string; readonly runId: string }>();
  expectTypeOf<Parameters<AttachmentStore["resolveForRun"]>[1]>().toEqualTypeOf<Record<string, never> | undefined>();
  expectTypeOf<ReturnType<AttachmentStore["resolveForRun"]>>().toEqualTypeOf<Promise<StoredAttachment | undefined>>();
});

test("claim returns an AttachmentClaim and listPendingForOwner returns PendingAttachmentSummary[]", () => {
  expectTypeOf<ReturnType<AttachmentStore["claim"]>>().toEqualTypeOf<Promise<AttachmentClaim>>();
  expectTypeOf<AttachmentClaim>().toEqualTypeOf<{ attachments: StoredAttachment[]; batchDirectory?: string }>();
  expectTypeOf<ReturnType<AttachmentStore["listPendingForOwner"]>>().toEqualTypeOf<Promise<PendingAttachmentSummary[]>>();
});

test("a hand-written fake satisfies Pick<AttachmentStore, 'resolveForRun'> and behaves as the port documents", async () => {
  const known: StoredAttachment = { path: "/site/uploads/a.png", name: "a.png", kind: "image", size: 3 };
  const fake: ChatAttachmentLookup = {
    resolveForRun: async ({ ref, runId }) => (ref === "attachment:known" && runId === "run-1" ? known : undefined),
  };
  expectTypeOf(fake).toMatchTypeOf<ChatAttachmentLookup>();

  assert.deepEqual(await fake.resolveForRun({ ref: "attachment:known", runId: "run-1" }), known);
  assert.equal(await fake.resolveForRun({ ref: "attachment:known", runId: "run-2" }), undefined);
});
