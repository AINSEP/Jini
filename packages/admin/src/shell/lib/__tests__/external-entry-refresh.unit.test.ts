import { describe, expect, it } from "vitest";

import { decideExternalEntryRefresh, isNewerRevision } from "../external-entry-refresh.js";

/**
 * @file Pure decision tests for `decideExternalEntryRefresh` / `isNewerRevision` — see the source
 * file's own header for why `version` is the change signal and why `saving` outranks `dirty`.
 */

describe("isNewerRevision", () => {
  it("is false when nothing is loaded yet", () => {
    expect(isNewerRevision({ loaded: null, fresh: { id: "a", version: 2 } })).toBe(false);
  });

  it("is false for a different id even with a higher version", () => {
    expect(isNewerRevision({ loaded: { id: "a", version: 1 }, fresh: { id: "b", version: 5 } })).toBe(false);
  });

  it("is false for the same version", () => {
    expect(isNewerRevision({ loaded: { id: "a", version: 3 }, fresh: { id: "a", version: 3 } })).toBe(false);
  });

  it("is false for an older version", () => {
    expect(isNewerRevision({ loaded: { id: "a", version: 3 }, fresh: { id: "a", version: 2 } })).toBe(false);
  });

  it("is true for a strictly higher version on the same id", () => {
    expect(isNewerRevision({ loaded: { id: "a", version: 3 }, fresh: { id: "a", version: 4 } })).toBe(true);
  });
});

describe("decideExternalEntryRefresh", () => {
  it("ignores when nothing is loaded yet", () => {
    const decision = decideExternalEntryRefresh({
      loaded: null,
      fresh: { id: "a", version: 2 },
      dirty: true,
      saving: false,
      dismissedForBasisVersion: null,
    });
    expect(decision).toBe("ignore");
  });

  it("ignores a row with a different id", () => {
    const decision = decideExternalEntryRefresh({
      loaded: { id: "a", version: 1 },
      fresh: { id: "b", version: 5 },
      dirty: false,
      saving: false,
      dismissedForBasisVersion: null,
    });
    expect(decision).toBe("ignore");
  });

  it("ignores the same version (a read-only tool result)", () => {
    const decision = decideExternalEntryRefresh({
      loaded: { id: "a", version: 3 },
      fresh: { id: "a", version: 3 },
      dirty: false,
      saving: false,
      dismissedForBasisVersion: null,
    });
    expect(decision).toBe("ignore");
  });

  it("ignores an older version (a slow fetch that started before the editor's own save)", () => {
    const decision = decideExternalEntryRefresh({
      loaded: { id: "a", version: 5 },
      fresh: { id: "a", version: 4 },
      dirty: false,
      saving: false,
      dismissedForBasisVersion: null,
    });
    expect(decision).toBe("ignore");
  });

  it("ignores a newer version while a save is in flight, even when clean", () => {
    const decision = decideExternalEntryRefresh({
      loaded: { id: "a", version: 3 },
      fresh: { id: "a", version: 4 },
      dirty: false,
      saving: true,
      dismissedForBasisVersion: null,
    });
    expect(decision).toBe("ignore");
  });

  it("applies a newer version when the editor is clean", () => {
    const decision = decideExternalEntryRefresh({
      loaded: { id: "a", version: 3 },
      fresh: { id: "a", version: 4 },
      dirty: false,
      saving: false,
      dismissedForBasisVersion: null,
    });
    expect(decision).toBe("apply");
  });

  it("notifies on a newer version when the editor is dirty", () => {
    const decision = decideExternalEntryRefresh({
      loaded: { id: "a", version: 3 },
      fresh: { id: "a", version: 4 },
      dirty: true,
      saving: false,
      dismissedForBasisVersion: null,
    });
    expect(decision).toBe("notify");
  });

  it("ignores when the operator already chose Keep my edits on this same basis", () => {
    const decision = decideExternalEntryRefresh({
      loaded: { id: "a", version: 3 },
      fresh: { id: "a", version: 4 },
      dirty: true,
      saving: false,
      dismissedForBasisVersion: 3,
    });
    expect(decision).toBe("ignore");
  });

  it("notifies again once the basis has moved past the dismissed one", () => {
    const decision = decideExternalEntryRefresh({
      loaded: { id: "a", version: 4 },
      fresh: { id: "a", version: 5 },
      dirty: true,
      saving: false,
      dismissedForBasisVersion: 3,
    });
    expect(decision).toBe("notify");
  });
});
