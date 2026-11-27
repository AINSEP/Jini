// @vitest-environment jsdom
import userEvent from "@testing-library/user-event";
import { useNativeDialog } from "@jini-ai/ui-kit/react/native";
import { createElement, type FormEvent, type ReactNode } from "react";
import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FetchQueryProvider, useCachedLoader, useFetchMutation, useFetchQuery, useFetchQueryScope, useInvalidate } from "@jini-ai/ui/fetch-query";
import type { AdminPolicy, AdminPolicyPermission, AdminRole, RolesPort } from "@jini-ai/core/contracts/site/user-management-react";
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

const kit = fakeAdminKit({ hooks: { useNativeDialog }, query: { useFetchQuery, useFetchMutation, useCachedLoader, useInvalidate, useFetchQueryScope } });

function wrapper({ children }: { children: ReactNode }) {
  return createElement(AdminKitProvider, { kit, children: createElement(FetchQueryProvider, { children }) });
}

const ROLE: AdminRole = { id: "r1", workspaceId: "w1", name: "Editor", isBuiltin: false, version: 1 };
const POLICY: AdminPolicy = { id: "p1", workspaceId: "w1", name: "Content", description: "d", isBuiltin: false, version: 1, isFrozen: false };

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

function renderScreen(port: RolesPort = fakePort(), tabId = "roles") {
  const goToTab = vi.fn();
  const view = render(
    <Roles tabId={tabId} useRolesHook={() => useRoles(deps(port))} goToTab={goToTab} usersHref="/host/users" />,
    { wrapper },
  );
  return { goToTab, view };
}

describe("Roles screen (host-bound props)", () => {

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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { resolve, promise };
}

const BUILTIN_POLICY: AdminPolicy = { ...POLICY, id: "builtin", name: "Inherited", description: undefined, isBuiltin: true };
const FROZEN_POLICY: AdminPolicy = { ...POLICY, id: "frozen", name: "Archived", isFrozen: true };
const PERMISSION: AdminPolicyPermission = { id: "grant-7", workspaceId: "w1", policyId: "p1", permission: "content.write", resourceType: "article" };

async function choose(user: ReturnType<typeof userEvent.setup>, trigger: string, action: string) {
  await user.click(screen.getByRole("button", { name: trigger }));
  await user.click(within(screen.getByRole("menu", { name: trigger })).getByRole("menuitem", { name: action }));
}

it("creates an editable policy and keeps built-in and frozen rows non-actionable", async () => {
  const user = userEvent.setup();
  let policies: AdminPolicy[] = [];
  const creation = deferred<void>();
  const createPolicy = vi.fn<RolesPort["createPolicy"]>(async ({ name }, options) => {
    await creation.promise;
    const policy = { ...POLICY, name, description: options?.description };
    policies = [policy, BUILTIN_POLICY, FROZEN_POLICY];
    return { policy };
  }).mockRejectedValueOnce(new FakeApiError("Name is already taken", "VALIDATION_ERROR"));
  const port = fakePort({ createPolicy, listPolicies: async () => ({ policies }) });
  renderScreen(port, "policies");
  expect(await screen.findByText("No policies yet.")).toBeVisible();
  const create = screen.getByRole("button", { name: "Create policy" });
  expect(create).toBeDisabled();
  const name = screen.getByRole("textbox", { name: "Policy name" });
  const description = screen.getByRole("textbox", { name: "Description (optional)" });
  await user.type(name, "Editorial");
  await user.type(description, "Editors only");
  await user.click(create);
  expect(await screen.findByText("Name is already taken")).toBeVisible();
  expect(name).toHaveValue("Editorial");
  expect(description).toHaveValue("Editors only");
  await user.click(create);
  expect(screen.getByRole("button", { name: "Creating…" })).toBeDisabled();
  await act(async () => { creation.resolve(); await creation.promise; });
  const row = within(await screen.findByRole("row", { name: /Editorial Editors only Custom/ }));
  expect(row.getByRole("button", { name: 'Actions for policy "Editorial"' })).toBeVisible();
  expect(name).toHaveValue("");
  expect(description).toHaveValue("");
  expect(createPolicy.mock.calls).toEqual([
    [{ name: "Editorial" }, { description: "Editors only" }],
    [{ name: "Editorial" }, { description: "Editors only" }],
  ]);
  for (const [label, type] of [["Inherited", "Built-in"], ["Archived", "Custom (frozen)"]]) {
    const locked = within(screen.getByText(label!).closest("tr")!);
    expect(locked.getByText(type!)).toBeVisible();
    expect(locked.queryByRole("button")).toBeNull();
  }
});

it("renames a policy using its loaded version, then requires separate confirmation to delete it", async () => {
  const user = userEvent.setup();
  let policies = [POLICY];
  const update = deferred<void>();
  const updatePolicy = vi.fn<RolesPort["updatePolicy"]>(async ({ policyId }, options) => {
    await update.promise;
    const saved = { ...POLICY, id: policyId, name: options!.name!, description: options?.description, version: 2 };
    policies = [saved];
    return { policy: saved };
  }).mockRejectedValueOnce(new FakeApiError("invalid description", "VALIDATION_ERROR"));
  const deletion = deferred<void>();
  const deletePolicy = vi.fn<RolesPort["deletePolicy"]>(async () => { await deletion.promise; policies = []; })
    .mockRejectedValueOnce(new FakeApiError("attached", "RESOURCE_CONFLICT"));
  renderScreen(fakePort({ listPolicies: async () => ({ policies }), updatePolicy, deletePolicy }), "policies");
  await screen.findByText("Content");
  const oldMenu = 'Actions for policy "Content"';
  await choose(user, oldMenu, "Rename");
  const editing = within(screen.getByDisplayValue("Content").closest("tr")!);
  expect(editing.getByDisplayValue("Content")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("button", { name: oldMenu })).toBeVisible();

  await choose(user, oldMenu, "Rename");
  const rename = screen.getByDisplayValue("Content");
  const description = screen.getByDisplayValue("d");
  await user.clear(rename);
  await user.type(rename, "Editorial");
  await user.clear(description);
  await user.type(description, "Revised");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText("invalid description")).toBeVisible();
  expect(rename).toHaveValue("Editorial");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  await act(async () => { update.resolve(); await update.promise; });
  const newMenu = 'Actions for policy "Editorial"';
  await screen.findByRole("button", { name: newMenu });
  expect(updatePolicy.mock.calls).toEqual([
    [{ policyId: "p1" }, { name: "Editorial", description: "Revised", expectedVersion: 1 }],
    [{ policyId: "p1" }, { name: "Editorial", description: "Revised", expectedVersion: 1 }],
  ]);

  await choose(user, newMenu, "Delete");
  const dialog = within(screen.getByRole("dialog", { name: "Delete policy?" }));
  expect(dialog.getByText('Delete policy "Editorial"?')).toBeVisible();
  expect(deletePolicy.mock.calls).toEqual([]);
  await user.click(dialog.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(deletePolicy.mock.calls).toEqual([]);
  await choose(user, newMenu, "Delete");
  await user.click(dialog.getByRole("button", { name: "Delete" }));
  expect(await screen.findByText("It is still in use — remove that assignment/attachment first.")).toBeVisible();
  expect(screen.getByRole("button", { name: newMenu })).toBeVisible();
  await choose(user, newMenu, "Delete");
  await user.click(dialog.getByRole("button", { name: "Delete" }));
  expect(dialog.getByRole("button", { name: "Delete" })).toBeDisabled();
  await act(async () => { deletion.resolve(); await deletion.promise; });
  expect(await screen.findByText("No policies yet.")).toBeVisible();
  expect(deletePolicy.mock.calls).toEqual([[{ policyId: "p1" }], [{ policyId: "p1" }]]);
});

it("saves a scoped permission, refreshes the open list and removes it only after confirmation", async () => {
  const user = userEvent.setup();
  const initialRead = deferred<{ policyPermissions: AdminPolicyPermission[] }>();
  let rows: AdminPolicyPermission[] = [];
  const listPolicyPermissions = vi.fn<RolesPort["listPolicyPermissions"]>(async () => ({ policyPermissions: rows }))
    .mockImplementationOnce(() => initialRead.promise);
  const write = deferred<void>();
  const writePolicyPermission = vi.fn<RolesPort["writePolicyPermission"]>(async () => {
    await write.promise;
    rows = [PERMISSION, { ...PERMISSION, id: "grant-8", permission: "content.read", resourceType: null }];
    return { policyPermission: PERMISSION };
  }).mockRejectedValueOnce(new FakeApiError("bad permission", "PERMISSION_UNKNOWN"));
  const removal = deferred<void>();
  const removePolicyPermission = vi.fn<RolesPort["removePolicyPermission"]>(async ({ policyPermissionId }) => {
    await removal.promise;
    rows = rows.filter(row => row.id !== policyPermissionId);
  }).mockRejectedValueOnce(new FakeApiError("refused", "FORBIDDEN"));
  renderScreen(fakePort({ listPolicyPermissions, writePolicyPermission, removePolicyPermission }), "policies");
  const menu = 'Actions for policy "Content"';
  await screen.findByRole("button", { name: menu });
  await choose(user, menu, "Add permission");
  expect(screen.getByText("Loading permissions…")).toBeVisible();
  await act(async () => { initialRead.resolve({ policyPermissions: [] }); await initialRead.promise; });
  expect(screen.getByText("No permissions yet.")).toBeVisible();
  const input = screen.getByPlaceholderText("e.g. content.write");
  const resource = screen.getByPlaceholderText("resource type (optional)");
  expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
  await user.type(input, "content.write");
  await user.type(resource, "article");
  await user.click(screen.getByRole("button", { name: "Add" }));
  expect(await screen.findByText("That permission is not recognized.")).toBeVisible();
  expect(input).toHaveValue("content.write");
  await user.click(screen.getByRole("button", { name: "Add" }));
  expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  await act(async () => { write.resolve(); await write.promise; });
  expect(input).toHaveValue("");
  expect(resource).toHaveValue("");
  const remove = await screen.findByRole("button", { name: "Remove permission content.write" });
  expect(within(remove.closest("li")!).getByText("(article)")).toBeVisible();
  expect(writePolicyPermission.mock.calls).toEqual([
    [{ policyId: "p1", permission: "content.write" }, { resourceType: "article" }],
    [{ policyId: "p1", permission: "content.write" }, { resourceType: "article" }],
  ]);

  await user.click(remove);
  const dialog = within(screen.getByRole("dialog", { name: "Remove permission?" }));
  expect(dialog.getByText(/Anyone with this policy loses it\./)).toHaveTextContent('Remove "content.write (article)" from this policy? Anyone with this policy loses it.');
  expect(removePolicyPermission.mock.calls).toEqual([]);
  await user.click(dialog.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(removePolicyPermission.mock.calls).toEqual([]);
  await user.click(remove);
  await user.click(dialog.getByRole("button", { name: "Remove" }));
  expect(await screen.findByText("You do not have permission to do that.")).toBeVisible();
  expect(remove).toBeVisible();
  await user.click(remove);
  await user.click(dialog.getByRole("button", { name: "Remove" }));
  expect(dialog.getByRole("button", { name: "Remove" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Remove permission content.write" })).toHaveTextContent("Removing…");
  await act(async () => { removal.resolve(); await removal.promise; });
  expect(screen.queryByRole("button", { name: "Remove permission content.write" })).toBeNull();
  expect(screen.getByRole("button", { name: "Remove permission content.read" })).toBeVisible();
  expect(removePolicyPermission.mock.calls).toEqual([
    [{ policyId: "p1", policyPermissionId: "grant-7" }],
    [{ policyId: "p1", policyPermissionId: "grant-7" }],
  ]);
  expect(listPolicyPermissions.mock.calls).toEqual([[{ policyId: "p1" }], [{ policyId: "p1" }], [{ policyId: "p1" }]]);
  await choose(user, menu, "Close");
  expect(screen.queryByText("Current permissions")).toBeNull();
});

it("renames a custom role with its version, preserves a built-in role, and deletes only after confirmation", async () => {
  const user = userEvent.setup();
  const builtin = { ...ROLE, id: "builtin", name: "Maintainer", isBuiltin: true };
  let roles = [ROLE, builtin];
  const updateRole = vi.fn<RolesPort["updateRole"]>(async ({ name }) => {
    const saved = { ...ROLE, name, version: 2 };
    roles = [saved, builtin];
    return { role: saved };
  }).mockRejectedValueOnce(new FakeApiError("invalid", "VALIDATION_ERROR"));
  const deleteRole = vi.fn<RolesPort["deleteRole"]>(async () => { roles = [builtin]; });
  renderScreen(fakePort({ listRoles: async () => ({ roles }), updateRole, deleteRole }));
  const oldMenu = 'Actions for role "Editor"';
  await screen.findByRole("button", { name: oldMenu });
  expect(within(screen.getByText("Maintainer").closest("tr")!).queryByRole("button")).toBeNull();
  await choose(user, oldMenu, "Rename");
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("button", { name: oldMenu })).toBeVisible();
  await choose(user, oldMenu, "Rename");
  const name = screen.getByDisplayValue("Editor");
  await user.clear(name);
  await user.type(name, "Publisher");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText("invalid")).toBeVisible();
  expect(name).toHaveValue("Publisher");
  await user.click(screen.getByRole("button", { name: "Save" }));
  const newMenu = 'Actions for role "Publisher"';
  await screen.findByRole("button", { name: newMenu });
  expect(updateRole.mock.calls).toEqual([
    [{ roleId: "r1", name: "Publisher", expectedVersion: 1 }],
    [{ roleId: "r1", name: "Publisher", expectedVersion: 1 }],
  ]);

  await choose(user, newMenu, "Delete");
  const dialog = within(screen.getByRole("dialog", { name: "Delete role?" }));
  expect(dialog.getByText('Delete role "Publisher"?')).toBeVisible();
  expect(deleteRole.mock.calls).toEqual([]);
  await user.click(dialog.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  await choose(user, newMenu, "Delete");
  await user.click(dialog.getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: newMenu })).toBeNull());
  expect(deleteRole.mock.calls).toEqual([[{ roleId: "r1" }]]);
  expect(screen.getByText("Maintainer")).toBeVisible();
});

it("leaves the new policy's draft and permission rows alone when the old policy's save settles", async () => {
  const first = deferred<void>();
  const second = { ...POLICY, id: "p2", name: "Events", description: undefined };
  const otherPermission = { ...PERMISSION, id: "event-1", policyId: second.id, permission: "event.read" };
  const listPolicyPermissions = vi.fn<RolesPort["listPolicyPermissions"]>(async ({ policyId }) => {
    if (policyId === "p1") return { policyPermissions: [] };
    if (policyId === "p2") return { policyPermissions: [otherPermission] };
    throw new Error("Unexpected policy in read");
  });
  const writePolicyPermission = vi.fn<RolesPort["writePolicyPermission"]>(async () => {
    await first.promise;
    return { policyPermission: PERMISSION };
  });
  const port = fakePort({ listPolicies: async () => ({ policies: [POLICY, second] }), listPolicyPermissions, writePolicyPermission });
  const dependencies = deps(port);
  const { result } = renderHook(() => useRoles(dependencies), { wrapper });
  await waitFor(() => expect(result.current.policies).toEqual([POLICY, second]));
  await act(async () => { result.current.togglePermissionForm({ policyId: "p1" }); });
  await act(() => result.current.onWritePermission({ policyId: "p1" }));
  expect(writePolicyPermission.mock.calls).toEqual([]);
  act(() => result.current.setPermissionInput("content.write"));
  let writing!: Promise<void>;
  act(() => { writing = result.current.onWritePermission({ policyId: "p1" }); });
  expect(result.current.rowSavingId).toBe("p1");
  await act(async () => { result.current.togglePermissionForm({ policyId: "p2" }); });
  act(() => { result.current.setPermissionInput("event.update"); result.current.setResourceTypeInput("conference"); });
  expect(result.current.permissionRows).toEqual([otherPermission]);
  await act(async () => { first.resolve(); await writing; });
  expect(result.current).toMatchObject({
    permissionPolicyId: "p2", permissionInput: "event.update", resourceTypeInput: "conference", permissionRows: [otherPermission], rowSavingId: null,
  });
  expect(writePolicyPermission.mock.calls).toEqual([[{ policyId: "p1", permission: "content.write" }, { resourceType: undefined }]]);
  expect(listPolicyPermissions.mock.calls).toEqual([[{ policyId: "p1" }], [{ policyId: "p2" }]]);
});

it("orders permission loads by the currently open policy and surfaces only the relevant read failure", async () => {
  const former = deferred<{ policyPermissions: AdminPolicyPermission[] }>();
  const other = { ...POLICY, id: "p2", name: "Events" };
  const listPolicyPermissions = vi.fn<RolesPort["listPolicyPermissions"]>(async ({ policyId }) => {
    if (policyId === "p1") return former.promise;
    if (policyId === "p2") throw new FakeApiError("Connection timed out", "VALIDATION_ERROR");
    throw new Error("Unexpected policy in read");
  });
  const dependencies = deps(fakePort({ listPolicies: async () => ({ policies: [POLICY, other] }), listPolicyPermissions }));
  const { result } = renderHook(() => useRoles(dependencies), { wrapper });
  await waitFor(() => expect(result.current.policies).toEqual([POLICY, other]));
  act(() => result.current.togglePermissionForm({ policyId: "p1" }));
  expect(result.current.permissionsLoading).toBe(true);
  await act(async () => { result.current.togglePermissionForm({ policyId: "p2" }); });
  expect(result.current).toMatchObject({ permissionPolicyId: "p2", permissionRows: [], rowError: "Connection timed out", permissionsLoading: false });
  await act(async () => { former.resolve({ policyPermissions: [PERMISSION] }); await former.promise; });
  expect(result.current).toMatchObject({ permissionPolicyId: "p2", permissionRows: [], rowError: "Connection timed out", permissionsLoading: false });
  expect(listPolicyPermissions.mock.calls).toEqual([[{ policyId: "p1" }], [{ policyId: "p2" }]]);
});
