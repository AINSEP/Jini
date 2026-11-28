import { describe, expect, it } from "vitest";
import type { AdminTrashItemDto } from "@jini-ai/core/contracts/site/cms-trash";

import { actorLabel, coverageLine, describePurgeReport, describeRestoreReport, entityTypeLabel, itemSubtitle } from "./rules.js";

/** Marks every key it translated, so the tests prove the injected translator is the only source of copy. */
const translate = (key: string): string => `«${key}»`;

const item = (over: Partial<AdminTrashItemDto>): AdminTrashItemDto => ({ actorPrincipalId: "p1", actorIsSystem: false, ...over }) as AdminTrashItemDto;

describe("trash rules take their copy from the injected translator", () => {
  it("labels kinds, leaving unknown kinds as themselves", () => {
    expect(entityTypeLabel({ translate, entity: "post" })).toBe("«Post»");
    expect(entityTypeLabel({ translate, entity: { entityType: "post", displayKind: "page" } })).toBe("«Page»");
    expect(entityTypeLabel({ translate, entity: "future-kind" })).toBe("future-kind");
  });

  it("appends the shared-across-workspaces note to plugin subtitles only", () => {
    expect(itemSubtitle({ translate, item: { entityType: "plugin", subtitle: "x" } })).toBe("x · «Shared across all workspaces on this site.»");
    expect(itemSubtitle({ translate, item: { entityType: "post", subtitle: "x" } })).toBe("x");
  });

  it("names the actor, falling back through system, deleted and unknown", () => {
    expect(actorLabel({ translate, item: item({ actorUsername: null, actorIsSystem: true }) })).toEqual({ label: "«System»" });
    expect(actorLabel({ translate, item: item({ actorUsername: null }) })).toEqual({ label: "«Deleted user»" });
    expect(actorLabel({ translate, item: item({}) })).toEqual({ label: "«Unknown»" });
    expect(actorLabel({ translate, item: item({ actorUsername: "jo", actorPluginId: "forms" }) })).toEqual({ label: "jo + «AI»", title: "forms" });
  });

  it("describes batch outcomes", () => {
    expect(describeRestoreReport({ translate, report: { restored: 2, results: [{ outcome: "restored" }, { outcome: "restored" }] } as never })).toBe("«Restored.»");
    expect(describePurgeReport({ translate, report: { purged: 0, results: [{ outcome: "still-referenced" }] } as never })).toBe("«Nothing was deleted.» «Items still in use were not deleted.»");
    expect(coverageLine({ translate })).toContain("«Deleted items wait here");
  });

  it("gives a plugin with no subtitle just the shared-across-workspaces note", () => {
    expect(itemSubtitle({ translate, item: { entityType: "plugin", subtitle: null } })).toBe("«Shared across all workspaces on this site.»");
  });

  it("resolves an omitted actor username from the known users, else names the system actor", () => {
    const knownUsernames = new Map([["p1", "ana"]]);
    expect(actorLabel({ translate, item: item({}) }, { knownUsernames })).toEqual({ label: "ana" });
    expect(actorLabel({ translate, item: item({ actorPrincipalId: "p2" }) }, { knownUsernames })).toEqual({ label: "«Unknown»" });
    expect(actorLabel({ translate, item: item({ actorIsSystem: true }) })).toEqual({ label: "«System»" });
    expect(actorLabel({ translate, item: item({ actorPrincipalId: "system" }) })).toEqual({ label: "«System»" });
  });

  it("states partial batches as succeeded/total and an all-failed restore by name", () => {
    const restoreResults = [{ outcome: "restored" }, { outcome: "restored" }, { outcome: "not-found" }];
    expect(describeRestoreReport({ translate, report: { restored: 2, results: restoreResults } as never })).toBe("«Restored.» 2/3");
    expect(describeRestoreReport({ translate, report: { restored: 0, results: [{ outcome: "not-found" }] } as never })).toBe("«Nothing was restored.»");
    const purgeResults = [{ outcome: "purged" }, { outcome: "not-found" }, { outcome: "not-found" }];
    expect(describePurgeReport({ translate, report: { purged: 1, results: purgeResults } as never })).toBe("«Deleted permanently.» 1/3");
    expect(describePurgeReport({ translate, report: { purged: 3, results: [{ outcome: "purged" }, { outcome: "purged" }, { outcome: "purged" }] } as never })).toBe("«Deleted permanently.»");
  });
});
