import { afterEach, describe, expect, it, vi } from "vitest";
import { createStandingDraftLocalBackup, LOCAL_BACKUP_PRINCIPAL_ID } from "../standing-draft-local-backup.js";
import type { StandingDraftAutosaveInput } from "../../hooks/use-standing-draft-autosave.hooks.js";

afterEach(() => { vi.restoreAllMocks(); });

/** Hand-written in-memory stand-in for the slice of `Storage` the backup uses. */
function memoryStorage() {
  const items = new Map<string, string>();
  return {
    items,
    storage: {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => { items.set(key, value); },
      removeItem: (key: string) => { items.delete(key); },
    },
  };
}

/** A storage whose every access throws, as privacy modes and quota exhaustion do. */
const throwingStorage = {
  getItem: () => { throw new Error("SecurityError"); },
  setItem: () => { throw new Error("QuotaExceededError"); },
  removeItem: () => { throw new Error("SecurityError"); },
};

const draft: StandingDraftAutosaveInput = { bodyFormat: "html", bodyHtml: "<p>refused</p>", title: "T", slug: "t", baseVersion: 3 };
const SAVED_AT = "2026-10-21T00:00:00.000Z";

describe("createStandingDraftLocalBackup", () => {
  it("round-trips a refused draft under a principal-scoped key, recording that principal", () => {
    const { items, storage } = memoryStorage();
    const backup = createStandingDraftLocalBackup({ keyPrefix: "drafts.", getStorage: () => storage });
    backup.write({ entryId: "entry/1", draft, savedAt: SAVED_AT }, { principalId: "user@a" });
    expect([...items.keys()]).toEqual(["drafts.user%40a.entry%2F1"]);
    expect(backup.read({ entryId: "entry/1" }, { principalId: "user@a" })).toEqual({ ...draft, savedAt: SAVED_AT, savedByPrincipalId: "user@a" });
    expect(backup.read({ entryId: "entry/1" }, { principalId: "user@b" })).toBeNull();
    backup.clear({ entryId: "entry/1" }, { principalId: "user@a" });
    expect(items.size).toBe(0);
  });

  it("uses the legacy unscoped key and the local marker principal when no principal is supplied", () => {
    const { items, storage } = memoryStorage();
    const backup = createStandingDraftLocalBackup({ keyPrefix: "drafts.", getStorage: () => storage });
    backup.write({ entryId: "e1", draft, savedAt: SAVED_AT });
    expect([...items.keys()]).toEqual(["drafts.e1"]);
    expect(backup.read({ entryId: "e1" })?.savedByPrincipalId).toBe(LOCAL_BACKUP_PRINCIPAL_ID);
    backup.clear({ entryId: "e1" });
    expect(backup.read({ entryId: "e1" })).toBeNull();
  });

  it("never touches storage for a known-anonymous (null) principal", () => {
    const getStorage = vi.fn(() => memoryStorage().storage);
    const backup = createStandingDraftLocalBackup({ keyPrefix: "drafts.", getStorage });
    backup.write({ entryId: "e1", draft, savedAt: SAVED_AT }, { principalId: null });
    expect(backup.read({ entryId: "e1" }, { principalId: null })).toBeNull();
    backup.clear({ entryId: "e1" }, { principalId: null });
    expect(getStorage).not.toHaveBeenCalled();
  });

  it("treats a corrupt stored value as no backup", () => {
    const { items, storage } = memoryStorage();
    items.set("drafts.e1", "{not json");
    const backup = createStandingDraftLocalBackup({ keyPrefix: "drafts.", getStorage: () => storage });
    expect(backup.read({ entryId: "e1" })).toBeNull();
  });

  it("survives storage that throws on every access, warning only on a lost write", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const backup = createStandingDraftLocalBackup({ keyPrefix: "drafts.", getStorage: () => throwingStorage });
    expect(() => backup.write({ entryId: "e1", draft, savedAt: SAVED_AT })).not.toThrow();
    expect(backup.read({ entryId: "e1" })).toBeNull();
    expect(() => backup.clear({ entryId: "e1" })).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("standing-draft local backup: could not write");
  });

  it("survives a storage getter that itself throws", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const backup = createStandingDraftLocalBackup({ keyPrefix: "drafts.", getStorage: () => { throw new Error("blocked"); } });
    expect(() => backup.write({ entryId: "e1", draft, savedAt: SAVED_AT }, { principalId: "u" })).not.toThrow();
    expect(backup.read({ entryId: "e1" }, { principalId: "u" })).toBeNull();
    expect(() => backup.clear({ entryId: "e1" }, { principalId: "u" })).not.toThrow();
  });
});
