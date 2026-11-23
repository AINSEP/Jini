// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, test } from "vitest";

import { AdminBootScopeContext, useAdminBootScope } from "../admin-boot-scope.js";
import { getAdminDraftIdentity, setAdminDraftIdentity } from "../admin-draft-identity.js";

/** L13 Stryker: `queryScope` is the cache key separating one user's queries from another's. */

function scoped(value: { principalId: string | null; checking: boolean }) {
  return ({ children }: { children: ReactNode }) => <AdminBootScopeContext.Provider value={value}>{children}</AdminBootScopeContext.Provider>;
}

test("an anonymous scope keys queries as anonymous; a principal keys them by its id", () => {
  expect(renderHook(() => useAdminBootScope(), { wrapper: scoped({ principalId: null, checking: true }) }).result.current)
    .toEqual({ principalId: null, checking: true, queryScope: "anonymous" });
  expect(renderHook(() => useAdminBootScope(), { wrapper: scoped({ principalId: "u-1", checking: false }) }).result.current)
    .toEqual({ principalId: "u-1", checking: false, queryScope: "principal:u-1" });
  expect(renderHook(() => useAdminBootScope(), { wrapper: scoped({ principalId: "", checking: false }) }).result.current.queryScope)
    .toBe("principal:", );
});

test("two principals never share a query scope", () => {
  const a = renderHook(() => useAdminBootScope(), { wrapper: scoped({ principalId: "a", checking: false }) }).result.current.queryScope;
  const b = renderHook(() => useAdminBootScope(), { wrapper: scoped({ principalId: "b", checking: false }) }).result.current.queryScope;
  expect(a).not.toBe(b);
});

test("without a provider the default scope is anonymous and not checking", () => {
  expect(renderHook(() => useAdminBootScope()).result.current).toEqual({ principalId: null, checking: false, queryScope: "anonymous" });
});

test("draft identity round-trips the last set id, including clearing it", () => {
  setAdminDraftIdentity({ id: "u-7" });
  expect(getAdminDraftIdentity()).toBe("u-7");
  setAdminDraftIdentity({ id: "u-8" });
  expect(getAdminDraftIdentity()).toBe("u-8");
  setAdminDraftIdentity({ id: null });
  expect(getAdminDraftIdentity()).toBeNull();
});
