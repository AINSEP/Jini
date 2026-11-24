import { describe, expect, it } from "vitest";
import type { PurgeReport, TrashItemAuthorizer } from "../../../../trash/index.js";
import { trashPurgeRoute, type TrashPurgeRouteDeps } from "../purge.js";
import { MAX_TRASH_SELECTION } from "../shared.js";
import { ENTRY_FORBIDDEN, fakeItem, PRINCIPAL, raw, recordingGate, refusalOf, signal, unexpected, WORKSPACE_ID } from "./helpers.js";

const REPORT: PurgeReport = { purged: 1, results: [{ id: "trash-1", outcome: "purged" }, { id: "trash-2", outcome: "forbidden" }] } as PurgeReport;
const INVALID = { status: 400, body: { error: `expected { ids: [string] } with 1..${MAX_TRASH_SELECTION} entries`, code: "INVALID_INPUT" } };

function deps(overrides: Partial<TrashPurgeRouteDeps> = {}): TrashPurgeRouteDeps {
  return { workspaceId: WORKSPACE_ID, authorizeEntry: recordingGate().authorizeEntry, trash: { purgeSelected: unexpected }, mayActOn: unexpected, ...overrides };
}
const run = (body: unknown, d: TrashPurgeRouteDeps, context: { id: string } | null = PRINCIPAL) =>
  trashPurgeRoute.handle({ input: { body }, deps: d, context: context ?? undefined }, { signal });

describe("trashPurgeRoute", () => {
  it("keeps the method, path, default status and no body cap", () => {
    expect(trashPurgeRoute.method).toBe("post");
    expect(trashPurgeRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/trash/purge");
    expect(trashPurgeRoute.successStatus).toBeUndefined();
    expect(trashPurgeRoute.maxBodyBytes).toBeUndefined();
    expect(trashPurgeRoute.parse(raw({}, { ids: ["a"] }))).toEqual({ ok: true, value: { body: { ids: ["a"] } } });
  });

  it("asks the entry gate for the principal before reading the selection, and a denial stops everything", async () => {
    const gate = recordingGate({ allowed: false, reason: "no_grant" });
    expect(await refusalOf(() => run(null, deps({ authorizeEntry: gate.authorizeEntry })))).toEqual(ENTRY_FORBIDDEN);
    expect(gate.calls).toEqual([{ principalId: PRINCIPAL.id }]);
  });

  it("refuses every malformed selection with the flat 400 and never purges", async () => {
    for (const body of [null, 1, {}, { ids: "x" }, { ids: [] }, { ids: Array(MAX_TRASH_SELECTION + 1).fill("a") }, { ids: ["a", 1] }, { ids: ["a", ""] }]) {
      expect(await refusalOf(() => run(body, deps()))).toEqual(INVALID);
    }
  });

  it("accepts exactly the cap, keeps duplicates and purges as the principal with a per-row kind check", async () => {
    const asked: { authorizeItem: TrashItemAuthorizer; rest: unknown }[] = [];
    const checks: unknown[] = [];
    const d = deps({
      trash: { purgeSelected: async ({ authorizeItem, ...rest }) => { asked.push({ authorizeItem, rest }); return REPORT; } },
      mayActOn: async (input) => { checks.push(input); return { allowed: input.entityType === "post" }; },
    });
    expect(await run({ ids: ["trash-1", "trash-1"] }, d)).toEqual({ ok: true, value: { purged: 1, results: REPORT.results } });
    expect(asked[0]?.rest).toEqual({ workspaceId: WORKSPACE_ID, ids: ["trash-1", "trash-1"], actor: { principalId: PRINCIPAL.id } });
    expect(await asked[0]?.authorizeItem({ item: fakeItem() })).toBe(true);
    expect(await asked[0]?.authorizeItem({ item: fakeItem({ entityType: "comment", entityId: "c-1" }) })).toBe(false);
    expect(checks).toEqual([
      { principalId: PRINCIPAL.id, entityType: "post", entityId: "post-1" },
      { principalId: PRINCIPAL.id, entityType: "comment", entityId: "c-1" },
    ]);
    expect((await run({ ids: Array(MAX_TRASH_SELECTION).fill("a") }, d)).ok).toBe(true);
  });

  it("fails closed without a principal and rethrows unexpected failures", async () => {
    await expect(run({ ids: ["a"] }, deps(), null)).rejects.toThrow(/no authenticated principal/);
    await expect(run({ ids: ["a"] }, deps({ trash: { purgeSelected: async () => { throw new Error("private"); } } }))).rejects.toThrow("private");
  });
});
