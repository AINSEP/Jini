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
});
