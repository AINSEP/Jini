// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { AdminKitProvider } from "../../../../react/kit.js";
import { fakeAdminKit } from "../../../../react/testing-kit.js";
import { useSecurityPermissions } from "../use-security-permissions.hooks.js";

const SITE_KEY = "admin.security.site-key.manage";

function setup(data: { effectivePermissions?: string[] } | undefined) {
  const port = { me: vi.fn(async () => ({ effectivePermissions: data?.effectivePermissions ?? [] })) };
  const queries: { key: readonly (string | number)[]; fetch: () => Promise<unknown> }[] = [];
  const kit = fakeAdminKit({
    query: {
      useFetchQuery: ((required: { key: readonly (string | number)[]; fetch: () => Promise<unknown> }) => {
        queries.push(required);
        return { data, error: null, status: data ? "success" : "loading", isFetching: !data, refetch: () => {} };
      }) as never,
    },
    values: { hasPermission: ({ permissions, permission }) => permissions.includes("*") || permissions.includes(permission) },
  });
  const wrapper = ({ children }: { children: ReactNode }) => <AdminKitProvider kit={kit}>{children}</AdminKitProvider>;
  return { port, queries, wrapper };
}

describe("useSecurityPermissions", () => {
  it.each([
    [[], false],
    [["admin.security.tokens.read"], false],
    [[SITE_KEY], true],
    [["admin.security.tokens.manage"], false],
    [["admin.security.tokens.manage", SITE_KEY], true],
    [["*"], true],
  ] as const)("evaluates the host's permission against %j after settlement", (effectivePermissions, expected) => {
    const { port, wrapper } = setup({ effectivePermissions: [...effectivePermissions] });
    const { result } = renderHook(() => useSecurityPermissions({ port, permission: SITE_KEY }), { wrapper });
    expect(result.current.canManageSiteKey).toBe(expected);
  });

  it("denies while the permissions read has not settled", () => {
    const { port, wrapper } = setup(undefined);
    const { result } = renderHook(() => useSecurityPermissions({ port, permission: SITE_KEY }), { wrapper });
    expect(result.current.canManageSiteKey).toBe(false);
  });

  it("checks the permission the caller passes, not a built-in one", () => {
    const { port, wrapper } = setup({ effectivePermissions: ["host.other.manage"] });
    const { result: other } = renderHook(() => useSecurityPermissions({ port, permission: "host.other.manage" }), { wrapper });
    const { result: siteKey } = renderHook(() => useSecurityPermissions({ port, permission: SITE_KEY }), { wrapper });
    expect(other.current.canManageSiteKey).toBe(true);
    expect(siteKey.current.canManageSiteKey).toBe(false);
  });

  it("reads the port's `me` under the namespaced security permissions key", async () => {
    const { port, queries, wrapper } = setup({ effectivePermissions: [] });
    renderHook(() => useSecurityPermissions({ port, permission: SITE_KEY }), { wrapper });
    expect(queries[0]!.key).toEqual(["security", "permissions"]);
    await queries[0]!.fetch();
    expect(port.me).toHaveBeenCalledTimes(1);
  });
});
