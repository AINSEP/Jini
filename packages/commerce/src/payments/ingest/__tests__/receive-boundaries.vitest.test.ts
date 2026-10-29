import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import type { WebhookFact } from "../../contract/evidence.js";
import { LedgerConstraintError } from "../../ledger/repo.js";
import { createWebhookReceiver } from "../receive.js";
import { PATH, SCOPE, T0, ingestWorld, type LedgerKind } from "./harness.js";

describe("third-party webhook fact validation", () => {
  test.each([
    ["missing event id", { providerRef: "ch_1" }],
    ["numeric event id", { providerEventId: 123, providerRef: "ch_1" }],
    ["empty provider ref", { providerEventId: "evt_bad", providerRef: "" }],
    ["numeric provider ref", { providerEventId: "evt_bad", providerRef: 123 }],
  ])("%s rejects the entire batch before recording a valid preceding fact", async (_label, invalid) => {
    const w = await ingestWorld();
    const provider = { ...w.provider, verifyWebhook: async () => ({ kind: "ok" as const, value: [
      { providerEventId: "evt_good", providerRef: "ch_1" }, invalid as unknown as WebhookFact,
    ] }) };
    expect(await w.receiver.receive({ endpoint: { scope: SCOPE, provider }, rawBody: Buffer.from("verified bytes"), headers: {} }))
      .toEqual({ status: 500, body: { code: "INVALID_FACT", message: "payments provider returned an unusable webhook fact" } });
    expect(await w.tx((tx) => tx.listDueInbox({ now: w.now(), limit: 10 }))).toEqual([]);
  });
});

for (const kind of ["memory", "sqlite"] as LedgerKind[]) {
  describe(`webhook receive atomicity on ${kind}`, () => {
    test("a mixed batch counts new and revived facts as received and preserves open and applied duplicates", async () => {
      const w = await ingestWorld(kind);
      const open = await w.insertInbox({ providerEventId: "evt_open", fact: { providerEventId: "evt_open", providerRef: "old_open" } });
      const dead = await w.insertInbox({ providerEventId: "evt_dead", fact: { providerEventId: "evt_dead", providerRef: "old_dead" } });
      const applied = await w.insertInbox({ providerEventId: "evt_applied", fact: { providerEventId: "evt_applied", providerRef: "old_applied" } });
      await w.tx(async (tx) => {
        await tx.deadInbox({ id: dead.id, error: "old failure" });
        await tx.markInboxApplied({ id: applied.id, appliedAt: T0 });
      });
      const beforeOpen = await w.inbox(open.id);
      const beforeApplied = await w.inbox(applied.id);
      w.clock.now += 17;
      const facts: WebhookFact[] = ["evt_open", "evt_dead", "evt_applied", "evt_new"].map((providerEventId) => ({ providerEventId, providerRef: "new_ref" }));
      const provider = { ...w.provider, verifyWebhook: async () => ({ kind: "ok" as const, value: facts }) };
      const rawBody = Buffer.from("fresh signed delivery");
      expect(await w.receiver.receive({ endpoint: { scope: SCOPE, provider }, rawBody, headers: {} }))
        .toEqual({ status: 200, body: { received: 2, duplicates: 2 } });
      expect(await w.inbox(open.id)).toEqual(beforeOpen);
      expect(await w.inbox(applied.id)).toEqual(beforeApplied);
      expect(await w.inbox(dead.id)).toMatchObject({
        state: "received", attempts: 0, nextAttemptAt: T0 + 17,
        factsJson: JSON.stringify({ providerEventId: "evt_dead", providerRef: "new_ref" }),
        bodySha256: createHash("sha256").update(rawBody).digest("hex"),
      });
      const due = await w.tx((tx) => tx.listDueInbox({ now: w.now(), limit: 10 }));
      expect(due.map((row) => row.providerEventId).sort()).toEqual(["evt_dead", "evt_new", "evt_open"]);
      expect(due.find((row) => row.providerEventId === "evt_new")).toMatchObject({ ...SCOPE, factsJson: JSON.stringify(facts[3]) });
    });

    test("a later insert failure rolls back every fact from the delivery", async () => {
      const w = await ingestWorld(kind);
      const facts: WebhookFact[] = [
        { providerEventId: "evt_first", providerRef: "ch_1" },
        { providerEventId: "evt_second", providerRef: "ch_2" },
      ];
      const provider = { ...w.provider, verifyWebhook: async () => ({ kind: "ok" as const, value: facts }) };
      const receiver = createWebhookReceiver({ ...w, newId: () => "colliding_inbox_id" });
      await expect(receiver.receive({ endpoint: { scope: SCOPE, provider }, rawBody: Buffer.from("signed"), headers: {} }))
        .rejects.toBeInstanceOf(LedgerConstraintError);
      expect(await w.inbox("colliding_inbox_id")).toBeNull();
      expect(await w.tx((tx) => tx.listDueInbox({ now: w.now(), limit: 10 }))).toEqual([]);
      expect(await w.receiver.receive({ endpoint: { scope: SCOPE, provider }, rawBody: Buffer.from("signed"), headers: {} }))
        .toEqual({ status: 200, body: { received: 2, duplicates: 0 } });
    });

    test("repeated ids inside one delivery are deduped using the trusted endpoint scope", async () => {
      const w = await ingestWorld(kind);
      const fact: WebhookFact = { providerEventId: "evt_same", providerRef: "ch_1" };
      const provider = { ...w.provider, verifyWebhook: async () => ({ kind: "ok" as const, value: [fact, fact] }) };
      const resolved = await w.receiver.resolveEndpoint({ path: PATH });
      if (!resolved.ok) throw new Error("configured endpoint missing");
      expect(await w.receiver.receive({ endpoint: { ...resolved.endpoint, provider }, rawBody: Buffer.from("signed"), headers: {} }))
        .toEqual({ status: 200, body: { received: 1, duplicates: 1 } });
      const rows = await w.tx((tx) => tx.listDueInbox({ now: w.now(), limit: 10 }));
      expect(rows).toEqual([expect.objectContaining({ ...SCOPE, providerEventId: "evt_same", factsJson: JSON.stringify(fact) })]);
    });
  });
}
