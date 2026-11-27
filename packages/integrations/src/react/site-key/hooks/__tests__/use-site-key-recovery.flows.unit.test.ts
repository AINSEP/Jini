// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminImportedSiteKey, AdminStartedFreshSiteKey } from "@jini-ai/core/contracts/site/site-key";
import { isSiteKeyLocked, siteKeyLockedNote, useSiteKeyRecovery, type SiteKeyRecoveryPort } from "../use-site-key-recovery.hooks.js";

afterEach(cleanup);

type Refusal = { code: string | undefined; message: string; detail: string | undefined };

function imported(resealed: number, _optional = {}): AdminImportedSiteKey {
  return { outcome: "unlocked", fingerprint: "fp", keyFilePath: "/keys/site-key", resealed, runtimeMode: "local" };
}

function setup(port: SiteKeyRecoveryPort, _optional: { refusal?: Refusal | null; onRecovered?: () => Promise<void> } = {}) {
  const describeApiError = vi.fn(({ e, fallback }: { e: unknown; fallback: string }) => `described:${(e as Error).message}:${fallback}`);
  const readApiRefusal = vi.fn((_required: { error: unknown }) => _optional.refusal ?? null);
  const hook = renderHook(() => useSiteKeyRecovery({
    port, t: key => `T(${key})`, onRecovered: _optional.onRecovered, describeApiError, readApiRefusal, copy: { unknownError: "unknown" },
  }));
  return { ...hook, describeApiError, readApiRefusal };
}

function port(_optional: Partial<SiteKeyRecoveryPort> = {}): SiteKeyRecoveryPort {
  return {
    importSiteKey: vi.fn(async () => imported(0)),
    previewStartFresh: vi.fn(async () => ({ removes: 0, affectedWebhooks: [], detail: "nothing", runtimeMode: "local" as const })),
    startFresh: vi.fn(async (): Promise<AdminStartedFreshSiteKey> => ({ outcome: "started-fresh", fingerprint: "new", keyFilePath: "/k", discarded: 0, kept: 0,
      restorePointId: "r", affectedWebhooks: [], runtimeMode: "local" })),
    ..._optional,
  };
}

describe("useSiteKeyRecovery unlock", () => {
  it("ignores a blank paste without calling the port", async () => {
    const p = port();
    const { result } = setup(p);
    act(() => result.current.setSiteKey("   "));
    await act(async () => { await result.current.unlock(); });
    expect(p.importSiteKey).toHaveBeenCalledTimes(0);
    expect(result.current.resultMessage).toBeNull();
  });

  it("imports the trimmed key, clears it, reports moved-over rows and re-reads status", async () => {
    const p = port({ importSiteKey: vi.fn(async () => imported(3)) });
    const onRecovered = vi.fn(async () => {});
    const { result } = setup(p, { onRecovered });
    act(() => result.current.setSiteKey("  abc123  "));
    await act(async () => { await result.current.unlock(); });
    expect(p.importSiteKey).toHaveBeenCalledExactlyOnceWith({ siteKey: "abc123" });
    expect(result.current.siteKey).toBe("");
    expect(result.current.resultMessage).toBe("T(Unlocked. Your saved credentials work again.) T({count} saved since were moved over.)".replace("{count}", "3"));
    expect(result.current.unlocking).toBe(false);
    expect(onRecovered).toHaveBeenCalledTimes(1);
  });

  it("a plain unlock with nothing resealed says only the base sentence", async () => {
    const { result } = setup(port());
    act(() => result.current.setSiteKey("k"));
    await act(async () => { await result.current.unlock(); });
    expect(result.current.resultMessage).toBe("T(Unlocked. Your saved credentials work again.)");
  });

  it("a refusal shows the server's detail and keeps the pasted key", async () => {
    const failure = new Error("409");
    const { result, describeApiError } = setup(port({ importSiteKey: vi.fn(async () => { throw failure; }) }),
      { refusal: { code: "wrong-key", message: "m", detail: "That key does not match; nothing changed." } });
    act(() => result.current.setSiteKey("k"));
    await act(async () => { await result.current.unlock(); });
    expect(result.current.unlockError).toBe("That key does not match; nothing changed.");
    expect(result.current.siteKey).toBe("k");
    expect(result.current.resultMessage).toBeNull();
    expect(describeApiError).toHaveBeenCalledTimes(0);
  });

  it("a refusal without detail falls back to the described error", async () => {
    const { result, readApiRefusal } = setup(port({ importSiteKey: vi.fn(async () => { throw new Error("down"); }) }),
      { refusal: { code: "x", message: "m", detail: undefined } });
    act(() => result.current.setSiteKey("k"));
    await act(async () => { await result.current.unlock(); });
    expect(result.current.unlockError).toBe("described:down:T(unknown)");
    expect(readApiRefusal.mock.calls[0]?.[0].error).toEqual(new Error("down"));
  });
});

describe("useSiteKeyRecovery start fresh", () => {
  it("a failed preview still opens the confirm step with the error and no preview", async () => {
    const { result } = setup(port({ previewStartFresh: vi.fn(async () => { throw new Error("preview"); }) }));
    await act(async () => { await result.current.openStartFresh(); });
    expect(result.current.startFreshStep).toBe("confirm");
    expect(result.current.preview).toBeNull();
    expect(result.current.startFreshError).toBe("described:preview:T(unknown)");
  });

  it("cancel closes the step and clears the typed text and error", async () => {
    const { result } = setup(port({ previewStartFresh: vi.fn(async () => { throw new Error("preview"); }) }));
    await act(async () => { await result.current.openStartFresh(); });
    act(() => result.current.setConfirmText("START"));
    act(() => result.current.cancelStartFresh());
    expect(result.current.startFreshStep).toBe("closed");
    expect(result.current.confirmText).toBe("");
    expect(result.current.startFreshError).toBeNull();
  });

  it("names affected webhooks in the result and re-reads status", async () => {
    const onRecovered = vi.fn(async () => {});
    const p = port({ startFresh: vi.fn(async (): Promise<AdminStartedFreshSiteKey> => ({ outcome: "started-fresh", fingerprint: "new", keyFilePath: "/k", discarded: 1, kept: 0,
      restorePointId: "r", affectedWebhooks: [{ label: "News", targetUrl: "https://a.test/h" }, { label: "Ops", targetUrl: "https://b.test/h" }], runtimeMode: "local" })) });
    const { result } = setup(p, { onRecovered });
    await act(async () => { await result.current.openStartFresh(); });
    act(() => result.current.setConfirmText("START FRESH"));
    await act(async () => { await result.current.startFresh(); });
    expect(result.current.resultMessage).toBe("T(Done. Re-enter any credentials that were removed.) T(Update these webhooks' receivers with their new signing secret:) News (https://a.test/h), Ops (https://b.test/h).");
    expect(result.current.startFreshStep).toBe("closed");
    expect(result.current.confirmText).toBe("");
    expect(onRecovered).toHaveBeenCalledTimes(1);
  });

  it("with no affected webhooks the result is the base sentence; a refused start keeps the step open", async () => {
    const ok = setup(port());
    act(() => ok.result.current.setConfirmText("START FRESH"));
    await act(async () => { await ok.result.current.startFresh(); });
    expect(ok.result.current.resultMessage).toBe("T(Done. Re-enter any credentials that were removed.)");
    const refused = setup(port({ startFresh: vi.fn(async () => { throw new Error("busy"); }) }));
    await act(async () => { await refused.result.current.openStartFresh(); });
    act(() => refused.result.current.setConfirmText("START FRESH"));
    await act(async () => { await refused.result.current.startFresh(); });
    expect(refused.result.current.startFreshError).toBe("described:busy:T(unknown)");
    expect(refused.result.current.startFreshStep).toBe("confirm");
    expect(refused.result.current.startingFresh).toBe(false);
    expect(refused.result.current.resultMessage).toBeNull();
  });
});

describe("isSiteKeyLocked / siteKeyLockedNote", () => {
  it("is locked for a locked generate refusal or a missing/mismatched key with data", () => {
    expect(isSiteKeyLocked({ status: undefined, generateError: { kind: "locked", code: "KEY_MISMATCH", detail: "x" } })).toBe(true);
    expect(isSiteKeyLocked({ status: undefined, generateError: null })).toBe(false);
    const base = { active: false, source: "none", keyFilePath: "/keys/site-key", runtimeMode: "local" } as const;
    expect(isSiteKeyLocked({ status: { ...base, state: "mismatch" }, generateError: null })).toBe(true);
    expect(isSiteKeyLocked({ status: { ...base, state: "missing-with-data" }, generateError: null })).toBe(true);
    expect(isSiteKeyLocked({ status: { ...base, state: "active" }, generateError: null })).toBe(false);
    expect(siteKeyLockedNote({ status: undefined, generateError: null, t: key => key })).toBeNull();
    expect(siteKeyLockedNote({ status: undefined, generateError: { kind: "locked", code: "KEY_MISMATCH", detail: "x" }, t: key => `T(${key})` }))
      .toBe("T(Your credentials need their original site key — use the card above.)");
  });
});
