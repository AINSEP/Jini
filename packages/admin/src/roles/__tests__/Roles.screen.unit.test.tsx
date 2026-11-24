// @vitest-environment jsdom
import { createElement, type FormEvent, type ReactNode } from "react";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FetchQueryProvider, useCachedLoader, useFetchMutation, useFetchQuery, useFetchQueryScope, useInvalidate } from "@jini-ai/ui/fetch-query";
import type { AdminPolicy, AdminRole, RolesPort } from "@jini-ai/core/contracts/site/user-management-react";
import { AdminKitProvider } from "../../react/kit.js";
import { fakeAdminKit } from "../../react/testing-kit.js";
import { useRoles, type RolesDependencies } from "../hooks/use-roles.hooks.js";
import { Roles } from "../Roles.js";
import { t } from "../roles-i18n.js";
import type { RolesApiErrorPort } from "../rules.js";

/**
 * @file Characterization of the Roles screen after its move into Jini: every host collaborator
 * (the `RolesPort`, the admin HTTP error port, the locale hook, the `?tab=` navigation and the
 * users route) arrives injected, and nothing here reaches a host module. The host's own binding
 * suites (in the host's roles feature) keep driving the same code through its real HTTP client.
 */

const kit = fakeAdminKit({ query: { useFetchQuery, useFetchMutation, useCachedLoader, useInvalidate, useFetchQueryScope } });

function wrapper({ children }: { children: ReactNode }) {
  return createElement(AdminKitProvider, { kit, children: createElement(FetchQueryProvider, { children }) });
}

const ROLE: AdminRole = { id: "r1", workspaceId: "w1", name: "Editor", isBuiltin: false };
const POLICY: AdminPolicy = { id: "p1", workspaceId: "w1", name: "Content", description: "d", isBuiltin: false, isFrozen: false };

function fakePort(overrides: Partial<RolesPort> = {}): RolesPort {
  return {
    listRoles: vi.fn(async () => ({ roles: [ROLE] })),
    listPolicies: vi.fn(async () => ({ policies: [POLICY] })),
    createRole: vi.fn(async ({ name }: { name: string }) => ({ role: { ...ROLE, id: "r2", name } })),
    updateRole: vi.fn(async ({ roleId, name }: { roleId: string; name: string }) => ({ role: { ...ROLE, id: roleId, name } })),
    deleteRole: vi.fn(async () => undefined),
    createPolicy: vi.fn(async ({ name }: { name: string }) => ({ policy: { ...POLICY, id: "p2", name } })),
    updatePolicy: vi.fn(async ({ policyId }: { policyId: string }) => ({ policy: { ...POLICY, id: policyId } })),
    deletePolicy: vi.fn(async () => undefined),
    writePolicyPermission: vi.fn(async () => ({ policyPermission: {} })),
    listPolicyPermissions: vi.fn(async () => ({ policyPermissions: [] })),
    removePolicyPermission: vi.fn(async () => undefined),
    ...overrides,
  } as RolesPort;
}

/** An `ApiError`-shaped class standing in for the host's, so `isApiError` is a real discriminator. */
class FakeApiError extends Error {
  constructor(message: string, readonly code?: string) { super(message); }
}
const errors: RolesApiErrorPort = {
  isApiError: (e): e is FakeApiError => e instanceof FakeApiError,
  describeDefault: ({ fallback }) => `default:${fallback}`,
};

function deps(port: RolesPort = fakePort()): RolesDependencies {
  return { port, errors, useAdminLocale: () => "en" };
}

describe("useRoles (injected collaborators)", () => {
  it("loads roles and policies through the injected port and binds t/locale from the injected locale hook", async () => {
    const { result } = renderHook(() => useRoles(deps()), { wrapper });
    await waitFor(() => expect(result.current.roles).toEqual([ROLE]));
    expect(result.current.policies).toEqual([POLICY]);
    expect(result.current.locale).toBe("en");
    expect(result.current.t({ key: "Remove" })).toBe(t({ locale: "en", key: "Remove" }));
  });

  it("a non-ApiError list failure is described by the injected port's default describer", async () => {
    const port = fakePort({ listRoles: vi.fn(async () => { throw new Error("network down"); }) });
    const { result } = renderHook(() => useRoles(deps(port)), { wrapper });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error).toBe(`default:${t({ locale: "en", key: "failed to load roles/policies" })}`);
  });

  it("an ApiError-shaped create failure goes through the injected isApiError (VALIDATION_ERROR shows its message)", async () => {
    const port = fakePort({ createRole: vi.fn(async () => { throw new FakeApiError("name is taken", "VALIDATION_ERROR"); }) });
    const { result } = renderHook(() => useRoles(deps(port)), { wrapper });
    await waitFor(() => expect(result.current.roles).not.toBeNull());
    act(() => result.current.setRoleName("Editor"));
    await act(async () => { await result.current.onCreateRole({ preventDefault() {} } as FormEvent).catch(() => undefined); });
    await waitFor(() => expect(result.current.roleError).toBe("name is taken"));
    expect(port.createRole).toHaveBeenCalledWith({ name: "Editor" });
  });
});

describe("Roles screen (host-bound props)", () => {
  function renderScreen(port: RolesPort = fakePort()) {
    const goToTab = vi.fn();
    const view = render(
      <Roles tabId="roles" useRolesHook={() => useRoles(deps(port))} goToTab={goToTab} usersHref="/host/users" />,
      { wrapper },
    );
    return { goToTab, view };
  }

  it("renders the page under jini-* classes and links the description to the host's users route", async () => {
    const { view } = renderScreen();
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toBeTruthy());
    expect(view.container.querySelector(".jini-page .jini-page-header .jini-page-title")).not.toBeNull();
    const link = view.container.querySelector(".jini-page-description a");
    expect(link?.getAttribute("href")).toBe("/host/users");
    expect(screen.getByText("Editor")).toBeTruthy();
  });

  it("a tab click is handed to the host's goToTab", async () => {
    const { goToTab } = renderScreen();
    const tabs = await screen.findAllByRole("tab");
    fireEvent.click(tabs[1]!);
    expect(goToTab).toHaveBeenCalledWith({ tabId: "policies" });
  });

  it("a list failure renders only the jini error notice", async () => {
    const { view } = renderScreen(fakePort({ listPolicies: vi.fn(async () => { throw new Error("x"); }) }));
    await waitFor(() => expect(view.container.querySelector(".jini-notice.jini-notice-error")).not.toBeNull());
    expect(view.container.querySelector(".jini-notice.jini-notice-error")?.textContent).toBe(`default:${t({ locale: "en", key: "failed to load roles/policies" })}`);
    expect(view.container.querySelector(".jini-page")).toBeNull();
  });
});
