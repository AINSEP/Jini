import { describe, expect, it } from "vitest";
import { ForbiddenError } from "../../../core/index.js";
import { PublishContentApplyRowError } from "../../transfer/index.js";
import { downgradeOrRethrow, downgradedRow, withRefusedItem, type PluginHookFailure } from "../apply-failure.js";
import type { PublishContentOutcomeRow } from "../plan-rows.js";
import type { PublishContentHandler } from "../type-registry.js";

const row = { entityType: "post", entityId: "p1", outcome: "applied", writes: true } as unknown as PublishContentOutcomeRow;
const handler = (isApplyConflict?: (e: unknown) => boolean) => ({ isApplyConflict }) as unknown as PublishContentHandler;

class HostHookError extends Error implements PluginHookFailure {
  readonly pluginId = "p";
}
const isPluginHookFailure = (e: unknown): e is PluginHookFailure => e instanceof HostHookError;
const attachRefusedItem = (f: PluginHookFailure, ref: string) => Object.assign(new Error(f.message, { cause: f }), { refusedItemRef: ref });

describe("withRefusedItem", () => {
  it("rebuilds a plugin hook refusal through the host with the active item", () => {
    const original = new HostHookError("refused");
    const out = withRefusedItem({ error: original, itemKey: "post:p1", isPluginHookFailure, attachRefusedItem }) as Error & { refusedItemRef: string };
    expect(out).not.toBe(original);
    expect(out.refusedItemRef).toBe("post:p1");
    expect(out.cause).toBe(original);
  });
  it("returns any other error, or a failure outside a row, unchanged", () => {
    const other = new Error("boom");
    expect(withRefusedItem({ error: other, itemKey: "post:p1", isPluginHookFailure, attachRefusedItem })).toBe(other);
    const hook = new HostHookError("refused");
    expect(withRefusedItem({ error: hook, itemKey: null, isPluginHookFailure, attachRefusedItem })).toBe(hook);
  });
});

describe("downgradeOrRethrow", () => {
  it("downgrades a row error to its own outcome and verbatim message", () => {
    const error = new PublishContentApplyRowError({ rowOutcome: "blocked", message: "slug taken" });
    expect(downgradeOrRethrow({ error, row, handler: handler() })).toEqual({
      row: { ...row, outcome: "blocked", writes: false, reason: "slug taken" }, changeSetId: null, retiredChangeSetId: null,
    });
  });
  it("downgrades a permission refusal to blocked", () => {
    const out = downgradeOrRethrow({ error: new ForbiddenError({ message: "no grant", permission: "post.write", reason: "denied" }), row, handler: handler() });
    expect(out.row.outcome).toBe("blocked");
    expect(out.row.reason).toBe("no grant");
  });
  it("prefixes a handler-named conflict", () => {
    const out = downgradeOrRethrow({ error: new Error("version moved"), row, handler: handler(() => true) });
    expect(out.row.outcome).toBe("conflict");
    expect(out.row.reason).toBe("post 'p1' changed on the destination during apply: version moved");
  });
  it("rethrows a genuine failure", () => {
    const error = new Error("disk full");
    expect(() => downgradeOrRethrow({ error, row, handler: handler(() => false) })).toThrow(error);
  });
  it("downgradedRow clears the change set ids and the write flag", () => {
    expect(downgradedRow({ row, outcome: "conflict", reason: "r" }).row.writes).toBe(false);
  });
});
