import { describe, expect, it } from "vitest";

// Deliberately NOT importing from ".." (the public barrel) — see fetch-query.test.tsx's own
// header for why that file is restricted to the public surface only. resolveFetchQueryStatus and
// resolveFetchQueryError are internal to this one adapter (resolveFetchQueryStatus's own
// tanstackStatus parameter is TanStack's own "pending" vocabulary, which the public QueryStatus
// contract doesn't use), so a direct import from the adapter module is correct here, not a lapse.
import { resolveFetchQueryError, resolveFetchQueryStatus } from "../adapter.react";

/**
 * @file Direct coverage for the two pure functions pulled out of `useFetchQuery`'s own body during
 * the 2026-08-06 complexity pass (nested ternaries flattened to top-level `if` chains — see each
 * function's own doc comment in `adapter.tanstack.tsx`). `fetch-query.test.tsx` already pins the
 * same behavior end-to-end through the public `useFetchQuery` hook; this exercises the branch
 * combinations directly, per this pass's rule that every extracted function gets its own test.
 */

describe("resolveFetchQueryStatus", () => {
  it("reports success when disabled with cached data", () => {
    expect(resolveFetchQueryStatus({ disabled: true, hasData: true, status: "pending" })).toBe("success");
  });

  it("reports loading when disabled with no data yet, regardless of tanstackStatus", () => {
    expect(resolveFetchQueryStatus({ disabled: true, hasData: false, status: "pending" })).toBe("loading");
    expect(resolveFetchQueryStatus({ disabled: true, hasData: false, status: "error" })).toBe("loading");
  });

  it("passes through error/success from tanstackStatus when enabled", () => {
    expect(resolveFetchQueryStatus({ disabled: false, hasData: false, status: "error" })).toBe("error");
    expect(resolveFetchQueryStatus({ disabled: false, hasData: true, status: "success" })).toBe("success");
  });

  it("folds tanstack's 'pending' into 'loading' when enabled", () => {
    expect(resolveFetchQueryStatus({ disabled: false, hasData: false, status: "pending" })).toBe("loading");
  });
});

describe("resolveFetchQueryError", () => {
  it("returns null when there is no raw error", () => {
    expect(resolveFetchQueryError({ error: null, disabled: false, hasData: false })).toBeNull();
  });

  it("suppresses a cached failure that never succeeded, once disabled", () => {
    expect(resolveFetchQueryError({ error: new Error("boom"), disabled: true, hasData: false })).toBeNull();
  });

  it("surfaces a failure from a later background refresh when disabled but data still exists", () => {
    const err = resolveFetchQueryError({ error: new Error("boom"), disabled: true, hasData: true });
    expect(err).toBeInstanceOf(Error);
    expect(err?.message).toBe("boom");
  });

  it("surfaces the error while enabled, and normalises a non-Error throw via toError's fallback", () => {
    const err = resolveFetchQueryError({ error: "not an Error instance", disabled: false, hasData: false });
    expect(err).toBeInstanceOf(Error);
    expect(err?.message).toBe("not an Error instance");
  });

  it("uses the literal fallback message ('request failed') when the thrown value is a non-string, not the string case above", () => {
    // Coverage-gap-fill (2026-09-05): the test above only exercises toError's `typeof value ===
    // "string" && value.trim()` TRUE branch (a non-empty string is used as-is). Neither sub-condition
    // had ever been false — this covers the non-string case; the next test covers the
    // whitespace-only-string case.
    const err = resolveFetchQueryError({ error: 42, disabled: false, hasData: false });
    expect(err).toBeInstanceOf(Error);
    expect(err?.message).toBe("request failed");
  });

  it("uses the fallback message for a whitespace-only string throw, not the blank string itself", () => {
    const err = resolveFetchQueryError({ error: "   ", disabled: false, hasData: false });
    expect(err).toBeInstanceOf(Error);
    expect(err?.message).toBe("request failed");
  });
});
