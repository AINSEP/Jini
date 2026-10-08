import { act, renderHook, waitFor } from "@testing-library/react";
import { assert, afterEach, describe, expect, it, vi } from "vitest";

import { FetchQueryProvider } from "@jini-ai/ui/fetch-query";
import type { RedirectImportRule } from "./legacy-harness.js";
import { createFakeRedirectsPort } from "./legacy-harness.js";
import { useImportRedirectsForm, useWiredImportRedirectsForm } from "./legacy-harness.js";

/**
 * @file `useImportRedirectsForm` (SPEC-037 REQ-04) — the bulk-import textarea's lifecycle.
 *
 * The adversarial case worth pinning here is precedence: a client-side PARSE failure
 * (`parseImportPayload`) must never reach the network, and once a request-level failure is on
 * screen, a later parse failure must replace it rather than stack with it — see the hook's own
 * `error = parseError ?? (importRules.error ? ... : null)` line.
 *
 * `t`/`locale` (2026-08-11, standing i18n rule — see `use-import-redirects-form.hooks.ts`'s own
 * file header): every call below passes `fakeT`/`fakeLocale`, matching
 * `wired-hooks-convention.md`'s own `t: (k) => k` example — except the dedicated "injected t/locale
 * are genuinely returned" group.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function fakeSubmitEvent(): React.FormEvent {
  return { preventDefault: vi.fn() } as unknown as React.FormEvent;
}

function wrapper({ children }: { children: React.ReactNode }) {
  return <FetchQueryProvider>{children}</FetchQueryProvider>;
}

/** Identity translator for tests that don't care about `t`'s own behavior — see this file's header. */
const fakeT = (key: string): string => key;
const fakeLocale = "en";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useImportRedirectsForm — client-side parse gate", () => {
  it("rejects invalid JSON without ever calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useWiredImportRedirectsForm({ t: fakeT, locale: fakeLocale }), { wrapper });
    act(() => result.current.setRaw("not json"));
    await act(async () => result.current.submit(fakeSubmitEvent()));

    expect(result.current.error).toBe("Not valid JSON.");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.result).toBeNull();
  });

  it("rejects a non-array JSON payload without calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useWiredImportRedirectsForm({ t: fakeT, locale: fakeLocale }), { wrapper });
    act(() => result.current.setRaw('{"not":"an array"}'));
    await act(async () => result.current.submit(fakeSubmitEvent()));

    expect(result.current.error).toBe("Must be a JSON array of rule objects.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("useImportRedirectsForm — submit", () => {
  const VALID_RAW = JSON.stringify([{ matchType: "exact", fromPattern: "/a", toTarget: "/b", statusCode: 301 }]);

  it("submits parsed rules and surfaces the 207 created/failed breakdown as a result, not an error", async () => {
    const response = {
      created: [{ id: "r1", fromPattern: "/a", toTarget: "/b" }],
      failed: [{ index: 0, code: "DUPLICATE", message: "already exists" }],
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(response));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useWiredImportRedirectsForm({ t: fakeT, locale: fakeLocale }), { wrapper });
    act(() => result.current.setRaw(VALID_RAW));
    await act(async () => result.current.submit(fakeSubmitEvent()));

    expect(result.current.result).toEqual(response);
    expect(result.current.error).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const importCall = fetchMock.mock.calls[0];
    assert.isDefined(importCall);
    const [url, init] = importCall;
    expect(url).toBe("/api/admin/v1/workspaces/workspace-local/redirects/import");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ rules: JSON.parse(VALID_RAW) });
  });

  it("is importing for the duration of an in-flight submit", async () => {
    let resolveFetch!: (value: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((resolve) => (resolveFetch = resolve))),
    );

    const { result } = renderHook(() => useWiredImportRedirectsForm({ t: fakeT, locale: fakeLocale }), { wrapper });
    act(() => result.current.setRaw(VALID_RAW));

    let submitPromise!: Promise<void>;
    act(() => {
      submitPromise = result.current.submit(fakeSubmitEvent()) as unknown as Promise<void>;
    });
    await waitFor(() => expect(result.current.importing).toBe(true));

    await act(async () => {
      resolveFetch(jsonResponse({ created: [], failed: [] }));
      await submitPromise;
    });
    expect(result.current.importing).toBe(false);
  });

  it("surfaces a transport/route failure through describeApiError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "import route down" }, 500)));

    const { result } = renderHook(() => useWiredImportRedirectsForm({ t: fakeT, locale: fakeLocale }), { wrapper });
    act(() => result.current.setRaw(VALID_RAW));
    await act(async () => result.current.submit(fakeSubmitEvent()));

    expect(result.current.error).toBe("import route down");
    expect(result.current.result).toBeNull();
  });

  it("a later parse failure replaces an earlier request failure rather than stacking with it", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "import route down" }, 500));

    const { result } = renderHook(() => useWiredImportRedirectsForm({ t: fakeT, locale: fakeLocale }), { wrapper });
    act(() => result.current.setRaw(VALID_RAW));
    await act(async () => result.current.submit(fakeSubmitEvent()));
    expect(result.current.error).toBe("import route down");

    act(() => result.current.setRaw("not json"));
    await act(async () => result.current.submit(fakeSubmitEvent()));

    expect(result.current.error).toBe("Not valid JSON.");
  });

  it("clears the previous result at the start of a new submit", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValueOnce(jsonResponse({ created: [{ id: "r1" }], failed: [] }));

    const { result } = renderHook(() => useWiredImportRedirectsForm({ t: fakeT, locale: fakeLocale }), { wrapper });
    act(() => result.current.setRaw(VALID_RAW));
    await act(async () => result.current.submit(fakeSubmitEvent()));
    expect(result.current.result).not.toBeNull();

    // Second submit is an invalid-JSON attempt — the STALE result from the first submit must not
    // linger on screen next to the new parse error.
    act(() => result.current.setRaw("not json"));
    await act(async () => result.current.submit(fakeSubmitEvent()));
    expect(result.current.result).toBeNull();
  });
});

describe("useImportRedirectsForm — injected port (no fetch stub)", () => {
  const VALID_RAW = JSON.stringify([{ matchType: "exact", fromPattern: "/a", toTarget: "/b", statusCode: 301 }]);

  it("submits through the injected port and surfaces what it returns as `result`", async () => {
    const onImport = vi.fn((rules: RedirectImportRule[]) => ({
      created: [],
      failed: rules.map((_rule: unknown, index: number) => ({ index, code: "DUPLICATE", message: "already exists" })),
    }));
    const port = createFakeRedirectsPort({
      onImport,
    });
    const { result } = renderHook(() => useImportRedirectsForm(port, fakeT, fakeLocale), { wrapper });

    act(() => result.current.setRaw(VALID_RAW));
    await act(async () => result.current.submit(fakeSubmitEvent()));

    expect(result.current.result).toEqual({ created: [], failed: [{ index: 0, code: "DUPLICATE", message: "already exists" }] });
    expect(result.current.error).toBeNull();
    expect(onImport).toHaveBeenCalledTimes(1);
    expect(onImport).toHaveBeenCalledWith(JSON.parse(VALID_RAW));
  });

  /**
   * Negative verification: a port whose `importRedirects` rejects proves this hook's error path is
   * wired to the INJECTED dependency, not to a module-level `api`/`fetch` stub — breaking the port
   * (rather than global `fetch`) is enough to make the hook report a failure.
   */
  it("surfaces a rejected port call as an error", async () => {
    const port = createFakeRedirectsPort();
    port.importRedirects = async () => {
      throw new Error("port down");
    };
    const { result } = renderHook(() => useImportRedirectsForm(port, fakeT, fakeLocale), { wrapper });

    act(() => result.current.setRaw(VALID_RAW));
    await act(async () => result.current.submit(fakeSubmitEvent()));

    expect(result.current.error).toBe("port down");
    expect(result.current.result).toBeNull();
  });
});

describe("useImportRedirectsForm — injected t/locale are genuinely returned, not built internally", () => {
  /**
   * Standing i18n rule (2026-08-11, `ImportRedirectsForm` no longer imports `useAdminLocale`
   * itself): `t`/`locale` must come from the hook's own second/third parameters, not something
   * this hook quietly rebuilds internally. Distinctive fakes (not the identity `fakeT`/`"en"` every
   * other test in this file uses) prove the returned values are literally the ones passed in.
   * Mirrors `use-post-editor.hooks.unit.test.tsx`'s identical negative-verification group.
   */
  it("result.current.t/locale are exactly the injected values, not hook-internal ones", () => {
    const port = createFakeRedirectsPort();
    const distinctiveT = (key: string): string => `TRANSLATED[${key}]`;

    const { result } = renderHook(() => useImportRedirectsForm(port, distinctiveT, "fr"), { wrapper });

    expect(result.current.t("Bulk import")).toBe("TRANSLATED[Bulk import]");
    expect(result.current.t).toBe(distinctiveT);
    expect(result.current.locale).toBe("fr");
  });
});
