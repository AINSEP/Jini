import { StrictMode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FetchQueryProvider } from "@jini-ai/ui/panel-kit";
import type { AdminIdentityUser, AdminPolicyPermission } from "../../models.js";
import { createFakeUsersPort, createFakeRolesPort } from "../../testing.js";
import { useRoles } from "../hooks/use-roles.hooks.js";
const translate = (key: string) => key;
const fetchMock = vi.fn(() => { throw new Error("unexpected transport call"); });
beforeEach(() => { vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); fetchMock.mockClear(); });
function wrapper({ children }: { children: React.ReactNode }) { return <FetchQueryProvider>{children}</FetchQueryProvider>; }
const ROLE = { id: "r1", workspaceId: "w1", name: "Editor", isBuiltin: false };
const POLICY = { id: "p1", workspaceId: "w1", name: "Content", description: "d", isBuiltin: false, isFrozen: false };
describe("injected port (useX(dependencies) / useWiredX() conversion coverage)", () => {

  it("loads roles and policies through the injected port, without touching fetch", async () => {
    const port = createFakeRolesPort({}, { roles: [ROLE], policies: [POLICY] });
    const { result } = renderHook(() => useRoles({ port, translate, queryScope: "w1" }), { wrapper });
    await waitFor(() => expect(result.current.roles).not.toBeNull());

    expect(result.current.roles).toEqual([ROLE]);
    expect(result.current.policies).toEqual([POLICY]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("onCreateRole writes through the injected port and the list reflects the new role", async () => {
    const port = createFakeRolesPort({}, { roles: [ROLE], policies: [POLICY] });
    const { result } = renderHook(() => useRoles({ port, translate, queryScope: "w1" }), { wrapper });
    await waitFor(() => expect(result.current.roles).not.toBeNull());

    act(() => result.current.setRoleName("New Role"));
    await act(async () => {
      await result.current.onCreateRole({ preventDefault: () => {} } as unknown as React.FormEvent);
    });

    expect(port.roles).toHaveLength(2);
    expect(port.roles[1]?.name).toBe("New Role");
    await waitFor(() => expect(result.current.roles).toHaveLength(2));
    expect(result.current.roles?.[1]?.name).toBe("New Role");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("onCreatePolicy stores the name and description, clears both fields, and reloads", async () => {
    const port = createFakeRolesPort({}, { roles: [ROLE], policies: [POLICY] });
    const { result } = renderHook(() => useRoles({ port, translate, queryScope: "w1" }), { wrapper });
    await waitFor(() => expect(result.current.policies).toEqual([POLICY]));
    act(() => {
      result.current.setPolicyName("New Policy");
      result.current.setPolicyDescription("Limits posts");
    });
    await act(async () => {
      await result.current.onCreatePolicy({ preventDefault: () => {} } as unknown as React.FormEvent);
    });
    expect(port.policies[1]).toMatchObject({ name: "New Policy", description: "Limits posts" });
    await waitFor(() => expect(result.current.policies).toEqual(port.policies));
    expect(result.current.policyName).toBe("");
    expect(result.current.policyDescription).toBe("");
    expect(result.current.policySaving).toBe(false);
    expect(result.current.policyError).toBeNull();
  });

  it("onCreatePolicy keeps both fields and reports a failed create", async () => {
    const port = createFakeRolesPort({}, { policies: [POLICY], createPolicyError: new Error("create denied") });
    const { result } = renderHook(() => useRoles({ port, translate, queryScope: "w1" }), { wrapper });
    await waitFor(() => expect(result.current.policies).toEqual([POLICY]));
    act(() => {
      result.current.setPolicyName("New Policy");
      result.current.setPolicyDescription("Limits posts");
    });
    await act(async () => {
      await result.current.onCreatePolicy({ preventDefault: () => {} } as unknown as React.FormEvent);
    });
    await waitFor(() => expect(result.current.policyError).toBe("create denied"));
    expect(result.current.policyName).toBe("New Policy");
    expect(result.current.policyDescription).toBe("Limits posts");
    expect(result.current.policySaving).toBe(false);
    expect(port.policies).toEqual([POLICY]);
  });

  it("onSavePolicy persists both edited fields, closes the edit row, and reloads", async () => {
    const port = createFakeRolesPort({}, { roles: [ROLE], policies: [POLICY] });
    const { result } = renderHook(() => useRoles({ port, translate, queryScope: "w1" }), { wrapper });
    await waitFor(() => expect(result.current.policies).toEqual([POLICY]));
    act(() => result.current.startEditPolicy(POLICY));
    act(() => {
      result.current.setEditingPolicyName("Renamed Policy");
      result.current.setEditingPolicyDescription("Updated description");
    });
    await act(async () => result.current.onSavePolicy({ policyId: POLICY.id }));
    expect(port.policies).toEqual([{ ...POLICY, name: "Renamed Policy", description: "Updated description" }]);
    await waitFor(() => expect(result.current.policies).toEqual(port.policies));
    expect(result.current.editingPolicyId).toBeNull();
    expect(result.current.rowSavingId).toBeNull();
    expect(result.current.rowError).toBeNull();
  });

  it("onSavePolicy keeps the edit row and both drafts on failure", async () => {
    const port = createFakeRolesPort({}, { policies: [POLICY], updatePolicyError: new Error("update denied") });
    const { result } = renderHook(() => useRoles({ port, translate, queryScope: "w1" }), { wrapper });
    await waitFor(() => expect(result.current.policies).toEqual([POLICY]));
    act(() => result.current.startEditPolicy(POLICY));
    act(() => {
      result.current.setEditingPolicyName("Renamed Policy");
      result.current.setEditingPolicyDescription("Updated description");
    });
    await act(async () => result.current.onSavePolicy({ policyId: POLICY.id }));
    expect(result.current.rowError).toBe("update denied");
    expect(result.current.editingPolicyId).toBe(POLICY.id);
    expect(result.current.editingPolicyName).toBe("Renamed Policy");
    expect(result.current.editingPolicyDescription).toBe("Updated description");
    expect(result.current.rowSavingId).toBeNull();
    expect(port.policies).toEqual([POLICY]);
  });

  it("onDeleteRole removes the pending role through the injected port", async () => {
    const port = createFakeRolesPort({}, { roles: [ROLE], policies: [POLICY] });
    const { result } = renderHook(() => useRoles({ port, translate, queryScope: "w1" }), { wrapper });
    await waitFor(() => expect(result.current.roles).not.toBeNull());

    act(() => result.current.setPendingRoleDelete(ROLE));
    await act(async () => {
      await result.current.onDeleteRole();
    });

    expect(port.roles).toEqual([]);
    await waitFor(() => expect(result.current.roles).toEqual([]));
  });

  const PERMISSION_ROW = {
    id: "pp-1",
    workspaceId: "w1",
    policyId: POLICY.id,
    permission: "content.write",
    resourceType: null,
    constraintJson: null,
  };

  it("togglePermissionForm loads the policy's current permissions when it opens", async () => {
    const port = createFakeRolesPort({}, {
      roles: [ROLE],
      policies: [POLICY],
      initialPolicyPermissions: [PERMISSION_ROW],
    });
    const { result } = renderHook(() => useRoles({ port, translate, queryScope: "w1" }), { wrapper });
    await waitFor(() => expect(result.current.roles).not.toBeNull());

    expect(result.current.permissionRows).toEqual([]);
    await act(async () => result.current.togglePermissionForm({ policyId: POLICY.id }));

    await waitFor(() => expect(result.current.permissionRows).toEqual([PERMISSION_ROW]));
    expect(result.current.permissionsLoading).toBe(false);
  });

  it("togglePermissionForm clears the loaded rows when it closes", async () => {
    const port = createFakeRolesPort({}, {
      roles: [ROLE],
      policies: [POLICY],
      initialPolicyPermissions: [PERMISSION_ROW],
    });
    const { result } = renderHook(() => useRoles({ port, translate, queryScope: "w1" }), { wrapper });
    await waitFor(() => expect(result.current.roles).not.toBeNull());

    await act(async () => result.current.togglePermissionForm({ policyId: POLICY.id }));
    await waitFor(() => expect(result.current.permissionRows).toEqual([PERMISSION_ROW]));

    await act(async () => result.current.togglePermissionForm({ policyId: POLICY.id }));
    expect(result.current.permissionPolicyId).toBeNull();
    expect(result.current.permissionRows).toEqual([]);
  });

  it("onRemovePermission removes the row through the injected port and refreshes the list", async () => {
    const other = { ...PERMISSION_ROW, id: "pp-2", permission: "content.read" };
    const port = createFakeRolesPort({}, {
      roles: [ROLE],
      policies: [POLICY],
      initialPolicyPermissions: [PERMISSION_ROW, other],
    });
    const { result } = renderHook(() => useRoles({ port, translate, queryScope: "w1" }), { wrapper });
    await waitFor(() => expect(result.current.roles).not.toBeNull());
    await act(async () => result.current.togglePermissionForm({ policyId: POLICY.id }));
    await waitFor(() => expect(result.current.permissionRows).toHaveLength(2));

    await act(async () => {
      await result.current.onRemovePermission({ policyId: POLICY.id, policyPermissionId: PERMISSION_ROW.id });
    });

    expect(port.policyPermissions).toEqual([other]);
    expect(result.current.permissionRows).toEqual([other]);
    expect(result.current.rowError).toBeNull();
    expect(result.current.removingPermissionId).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("onRemovePermission sets rowError from the injected port's configured failure and keeps the row", async () => {
    const port = createFakeRolesPort({}, {
      roles: [ROLE],
      policies: [POLICY],
      initialPolicyPermissions: [PERMISSION_ROW],
      removePermissionError: new Error("boom"),
    });
    const { result } = renderHook(() => useRoles({ port, translate, queryScope: "w1" }), { wrapper });
    await waitFor(() => expect(result.current.roles).not.toBeNull());
    await act(async () => result.current.togglePermissionForm({ policyId: POLICY.id }));
    await waitFor(() => expect(result.current.permissionRows).toHaveLength(1));

    await act(async () => {
      await result.current.onRemovePermission({ policyId: POLICY.id, policyPermissionId: PERMISSION_ROW.id });
    });

    expect(result.current.rowError).toBe("boom");
    expect(port.policyPermissions).toEqual([PERMISSION_ROW]);
    expect(result.current.removingPermissionId).toBeNull();
  });

  it("onWritePermission sets rowError from the injected port's configured failure", async () => {
    const port = createFakeRolesPort({}, {
      roles: [ROLE],
      policies: [POLICY],
      writePermissionError: new Error("boom"),
    });
    const { result } = renderHook(() => useRoles({ port, translate, queryScope: "w1" }), { wrapper });
    await waitFor(() => expect(result.current.roles).not.toBeNull());

    act(() => result.current.setPermissionInput("content.write"));
    await act(async () => {
      await result.current.onWritePermission({ policyId: POLICY.id });
    });

    expect(result.current.rowError).toBe("boom");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe("pendingPermissionRemove / onConfirmRemovePermission (C1)", () => {
    it("setPendingPermissionRemove opens the confirmation without touching the port", async () => {
      const port = createFakeRolesPort({}, {
        roles: [ROLE],
        policies: [POLICY],
        initialPolicyPermissions: [PERMISSION_ROW],
      });
      const removeSpy = vi.spyOn(port, "removePolicyPermission");
      const { result } = renderHook(() => useRoles({ port, translate, queryScope: "w1" }), { wrapper });
      await waitFor(() => expect(result.current.roles).not.toBeNull());

      act(() => result.current.setPendingPermissionRemove({ policyId: POLICY.id, row: PERMISSION_ROW }));

      expect(result.current.pendingPermissionRemove).toEqual({ policyId: POLICY.id, row: PERMISSION_ROW });
      expect(removeSpy).not.toHaveBeenCalled();
      expect(port.policyPermissions).toEqual([PERMISSION_ROW]);
    });

    it("onConfirmRemovePermission removes the pending row, refreshes the list, and closes the confirmation", async () => {
      const other = { ...PERMISSION_ROW, id: "pp-2", permission: "content.read" };
      const port = createFakeRolesPort({}, {
        roles: [ROLE],
        policies: [POLICY],
        initialPolicyPermissions: [PERMISSION_ROW, other],
      });
      const { result } = renderHook(() => useRoles({ port, translate, queryScope: "w1" }), { wrapper });
      await waitFor(() => expect(result.current.roles).not.toBeNull());
      await act(async () => result.current.togglePermissionForm({ policyId: POLICY.id }));
      await waitFor(() => expect(result.current.permissionRows).toHaveLength(2));

      act(() => result.current.setPendingPermissionRemove({ policyId: POLICY.id, row: PERMISSION_ROW }));
      await act(async () => {
        await result.current.onConfirmRemovePermission();
      });

      expect(port.policyPermissions).toEqual([other]);
      expect(result.current.permissionRows).toEqual([other]);
      expect(result.current.pendingPermissionRemove).toBeNull();
      expect(result.current.removingPermissionId).toBeNull();
    });

    it("is a no-op with nothing pending", async () => {
      const port = createFakeRolesPort({}, { roles: [ROLE], policies: [POLICY], initialPolicyPermissions: [PERMISSION_ROW] });
      const removeSpy = vi.spyOn(port, "removePolicyPermission");
      const { result } = renderHook(() => useRoles({ port, translate, queryScope: "w1" }), { wrapper });
      await waitFor(() => expect(result.current.roles).not.toBeNull());

      await act(async () => {
        await result.current.onConfirmRemovePermission();
      });

      expect(removeSpy).not.toHaveBeenCalled();
    });

    it("a failed confirmed removal closes the confirmation and surfaces the exact error, keeping the row", async () => {
      const port = createFakeRolesPort({}, {
        roles: [ROLE],
        policies: [POLICY],
        initialPolicyPermissions: [PERMISSION_ROW],
        removePermissionError: new Error("boom"),
      });
      const { result } = renderHook(() => useRoles({ port, translate, queryScope: "w1" }), { wrapper });
      await waitFor(() => expect(result.current.roles).not.toBeNull());
      await act(async () => result.current.togglePermissionForm({ policyId: POLICY.id }));
      await waitFor(() => expect(result.current.permissionRows).toHaveLength(1));

      act(() => result.current.setPendingPermissionRemove({ policyId: POLICY.id, row: PERMISSION_ROW }));
      await act(async () => {
        await result.current.onConfirmRemovePermission();
      });

      expect(result.current.rowError).toBe("boom");
      expect(result.current.pendingPermissionRemove).toBeNull();
      expect(port.policyPermissions).toEqual([PERMISSION_ROW]);
    });

    it("a removal settling while a second removal is in flight must not clear the second row's busy state", async () => {
      const other = { ...PERMISSION_ROW, id: "pp-2", permission: "content.read" };
      const port = createFakeRolesPort({}, {
        roles: [ROLE],
        policies: [POLICY],
        initialPolicyPermissions: [PERMISSION_ROW, other],
      });

      const releasers: Array<() => void> = [];
      const realRemove = port.removePolicyPermission.bind(port);
      port.removePolicyPermission = vi.fn((input: { policyId: string; policyPermissionId: string }) => {
        return new Promise<void>((resolve) => {
          releasers.push(() => resolve(realRemove(input)));
        });
      });

      const { result } = renderHook(() => useRoles({ port, translate, queryScope: "w1" }), { wrapper });
      await waitFor(() => expect(result.current.roles).not.toBeNull());
      await act(async () => result.current.togglePermissionForm({ policyId: POLICY.id }));
      await waitFor(() => expect(result.current.permissionRows).toHaveLength(2));

      let p1!: Promise<void>;
      act(() => {
        p1 = result.current.onRemovePermission({ policyId: POLICY.id, policyPermissionId: PERMISSION_ROW.id });
      });
      expect(result.current.removingPermissionId).toBe(PERMISSION_ROW.id);

      await waitFor(() => expect(port.removePolicyPermission).toHaveBeenCalledTimes(1));

      let p2!: Promise<void>;
      act(() => {
        p2 = result.current.onRemovePermission({ policyId: POLICY.id, policyPermissionId: other.id });
      });
      expect(result.current.removingPermissionId).toBe(other.id);
      await waitFor(() => expect(port.removePolicyPermission).toHaveBeenCalledTimes(2));

      releasers[0]!();
      await act(async () => {
        await p1;
      });

      expect(result.current.removingPermissionId).toBe(other.id);

      releasers[1]!();
      await act(async () => {
        await p2;
      });
      expect(result.current.removingPermissionId).toBeNull();
    });
  });

  it("switching panels while the first load is in flight must not let the stale panel's rows win", async () => {
    const otherPolicy = { id: "p2", workspaceId: "w1", name: "Other", description: "", isBuiltin: false, isFrozen: false };
    const deferred: Record<string, { resolve: (v: { policyPermissions: AdminPolicyPermission[] }) => void }> = {};
    const port = createFakeRolesPort({}, { roles: [ROLE], policies: [POLICY, otherPolicy] });
    port.listPolicyPermissions = vi.fn(({ policyId }: { policyId: string }) => {
      return new Promise<{ policyPermissions: AdminPolicyPermission[] }>((resolve) => {
        deferred[policyId] = { resolve };
      });
    });

    const { result } = renderHook(() => useRoles({ port, translate, queryScope: "w1" }), { wrapper });
    await waitFor(() => expect(result.current.roles).not.toBeNull());

    act(() => result.current.togglePermissionForm({ policyId: POLICY.id }));
    act(() => result.current.togglePermissionForm({ policyId: otherPolicy.id }));
    await waitFor(() => expect(port.listPolicyPermissions).toHaveBeenCalledTimes(2));
    expect(result.current.permissionPolicyId).toBe(otherPolicy.id);

    await act(async () => {
      deferred[otherPolicy.id]!.resolve({
        policyPermissions: [{ id: "other-perm", workspaceId: "w1", policyId: otherPolicy.id, permission: "other.read", resourceType: null, constraintJson: null }],
      });
    });
    await waitFor(() => expect(result.current.permissionRows).toHaveLength(1));
    expect(result.current.permissionRows[0]!.policyId).toBe(otherPolicy.id);

    await act(async () => {
      deferred[POLICY.id]!.resolve({
        policyPermissions: [{ id: "policy-perm", workspaceId: "w1", policyId: POLICY.id, permission: "policy.read", resourceType: null, constraintJson: null }],
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(result.current.permissionPolicyId).toBe(otherPolicy.id);
    expect(result.current.permissionRows).toHaveLength(1);
    expect(result.current.permissionRows[0]!.policyId).toBe(otherPolicy.id);
  });

  it("onSaveRole: a stale save settling after the operator moved to editing a DIFFERENT role must not close that row's edit UI", async () => {
    const roleB = { id: "rB", workspaceId: "w1", name: "Beta", isBuiltin: false };
    let resolveA!: (v: { role: typeof ROLE }) => void;
    const port = createFakeRolesPort({}, { roles: [ROLE, roleB], policies: [POLICY] });
    port.updateRole = vi.fn(() => new Promise<{ role: typeof ROLE }>((resolve) => { resolveA = resolve; }));

    const { result } = renderHook(() => useRoles({ port, translate, queryScope: "w1" }), { wrapper });
    await waitFor(() => expect(result.current.roles).not.toBeNull());

    act(() => result.current.startEditRole(ROLE));
    act(() => {
      void result.current.onSaveRole({ roleId: ROLE.id });
    });
    await waitFor(() => expect(port.updateRole).toHaveBeenCalledTimes(1));

    act(() => result.current.startEditRole(roleB));
    expect(result.current.editingRoleId).toBe(roleB.id);

    await act(async () => {
      resolveA({ role: ROLE });
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(result.current.editingRoleId).toBe(roleB.id);
  });

  it("onSavePolicy: a stale save settling after the operator moved to editing a DIFFERENT policy must not close that row's edit UI", async () => {
    const policyB = { id: "pB", workspaceId: "w1", name: "Other", description: "", isBuiltin: false, isFrozen: false };
    let resolveA!: (v: { policy: typeof POLICY }) => void;
    const port = createFakeRolesPort({}, { roles: [ROLE], policies: [POLICY, policyB] });
    port.updatePolicy = vi.fn(() => new Promise<{ policy: typeof POLICY }>((resolve) => { resolveA = resolve; }));

    const { result } = renderHook(() => useRoles({ port, translate, queryScope: "w1" }), { wrapper });
    await waitFor(() => expect(result.current.roles).not.toBeNull());

    act(() => result.current.startEditPolicy(POLICY));
    act(() => {
      void result.current.onSavePolicy({ policyId: POLICY.id });
    });
    await waitFor(() => expect(port.updatePolicy).toHaveBeenCalledTimes(1));

    act(() => result.current.startEditPolicy(policyB));
    expect(result.current.editingPolicyId).toBe(policyB.id);

    await act(async () => {
      resolveA({ policy: POLICY });
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(result.current.editingPolicyId).toBe(policyB.id);
  });

  it("onDeleteRole: a stale delete settling after the operator opened a DIFFERENT row's delete confirmation must not silently close it", async () => {
    const roleB = { id: "rB", workspaceId: "w1", name: "Beta", isBuiltin: false };
    let resolveA!: () => void;
    const port = createFakeRolesPort({}, { roles: [ROLE, roleB], policies: [POLICY] });
    port.deleteRole = vi.fn(() => new Promise<void>((resolve) => { resolveA = resolve; }));

    const { result } = renderHook(() => useRoles({ port, translate, queryScope: "w1" }), { wrapper });
    await waitFor(() => expect(result.current.roles).not.toBeNull());

    act(() => result.current.setPendingRoleDelete(ROLE));
    act(() => {
      void result.current.onDeleteRole();
    });
    await waitFor(() => expect(port.deleteRole).toHaveBeenCalledTimes(1));

    act(() => result.current.setPendingRoleDelete(roleB));
    expect(result.current.pendingRoleDelete).toEqual(roleB);

    await act(async () => {
      resolveA();
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(result.current.pendingRoleDelete).toEqual(roleB);
  });

  it("onWritePermission: a stale write settling after the operator switched panels and typed a NEW value must not clear it", async () => {
    let resolveA!: (v: { policyPermission: unknown }) => void;
    const otherPolicy = { id: "p2", workspaceId: "w1", name: "Other", description: "", isBuiltin: false, isFrozen: false };
    const port = createFakeRolesPort({}, { roles: [ROLE], policies: [POLICY, otherPolicy] });
    port.writePolicyPermission = vi.fn(() => new Promise<{ policyPermission: unknown }>((resolve) => { resolveA = resolve; }));

    const { result } = renderHook(() => useRoles({ port, translate, queryScope: "w1" }), { wrapper });
    await waitFor(() => expect(result.current.roles).not.toBeNull());

    await act(async () => result.current.togglePermissionForm({ policyId: POLICY.id }));
    act(() => result.current.setPermissionInput("a.perm"));
    act(() => {
      void result.current.onWritePermission({ policyId: POLICY.id });
    });
    await waitFor(() => expect(port.writePolicyPermission).toHaveBeenCalledTimes(1));

    await act(async () => result.current.togglePermissionForm({ policyId: otherPolicy.id }));
    act(() => result.current.setPermissionInput("b.perm"));
    expect(result.current.permissionInput).toBe("b.perm");

    await act(async () => {
      resolveA({ policyPermission: {} });
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(result.current.permissionInput).toBe("b.perm");
  });

  describe("a policy write's trailing refresh must not repaint a DIFFERENT, now-open panel (C2)", () => {
    it("onWritePermission: a write settling after the operator opened a DIFFERENT policy's panel must not paint the old policy's rows into it", async () => {
      const otherPolicy = { id: "p2", workspaceId: "w1", name: "Other", description: "", isBuiltin: false, isFrozen: false };
      const rowA = { id: "pp-a", workspaceId: "w1", policyId: POLICY.id, permission: "content.read", resourceType: null, constraintJson: null };
      const rowB = { id: "pp-b", workspaceId: "w1", policyId: otherPolicy.id, permission: "other.read", resourceType: null, constraintJson: null };
      const port = createFakeRolesPort({}, {
        roles: [ROLE],
        policies: [POLICY, otherPolicy],
        initialPolicyPermissions: [rowA, rowB],
      });
      const realWrite = port.writePolicyPermission.bind(port);
      let release!: () => void;
      port.writePolicyPermission = vi.fn(
        (input: { policyId: string; permission: string }, opts?: { resourceType?: string }) => {
          return new Promise<{ policyPermission: unknown }>((resolve) => {
            release = () => resolve(realWrite(input, opts));
          });
        },
      );

      const { result } = renderHook(() => useRoles({ port, translate, queryScope: "w1" }), { wrapper });
      await waitFor(() => expect(result.current.roles).not.toBeNull());

      await act(async () => result.current.togglePermissionForm({ policyId: POLICY.id }));
      await waitFor(() => expect(result.current.permissionRows).toEqual([rowA]));

      act(() => result.current.setPermissionInput("content.write"));
      let p!: Promise<void>;
      act(() => {
        p = result.current.onWritePermission({ policyId: POLICY.id });
      });
      await waitFor(() => expect(port.writePolicyPermission).toHaveBeenCalledTimes(1));

      await act(async () => result.current.togglePermissionForm({ policyId: otherPolicy.id }));
      await waitFor(() => expect(result.current.permissionRows).toEqual([rowB]));

      release();
      await act(async () => {
        await p;
      });

      expect(result.current.permissionPolicyId).toBe(otherPolicy.id);
      expect(result.current.permissionRows).toEqual([rowB]);
      expect(result.current.permissionRows.every((row) => row.policyId === otherPolicy.id)).toBe(true);
    });

    it("onRemovePermission: a removal settling after the operator opened a DIFFERENT policy's panel must not paint the old policy's rows into it", async () => {
      const otherPolicy = { id: "p2", workspaceId: "w1", name: "Other", description: "", isBuiltin: false, isFrozen: false };
      const rowA1 = { id: "pp-a1", workspaceId: "w1", policyId: POLICY.id, permission: "content.read", resourceType: null, constraintJson: null };
      const rowA2 = { id: "pp-a2", workspaceId: "w1", policyId: POLICY.id, permission: "content.write", resourceType: null, constraintJson: null };
      const rowB = { id: "pp-b", workspaceId: "w1", policyId: otherPolicy.id, permission: "other.read", resourceType: null, constraintJson: null };
      const port = createFakeRolesPort({}, {
        roles: [ROLE],
        policies: [POLICY, otherPolicy],
        initialPolicyPermissions: [rowA1, rowA2, rowB],
      });
      const realRemove = port.removePolicyPermission.bind(port);
      let release!: () => void;
      port.removePolicyPermission = vi.fn((input: { policyId: string; policyPermissionId: string }) => {
        return new Promise<void>((resolve) => {
          release = () => resolve(realRemove(input));
        });
      });

      const { result } = renderHook(() => useRoles({ port, translate, queryScope: "w1" }), { wrapper });
      await waitFor(() => expect(result.current.roles).not.toBeNull());

      let p!: Promise<void>;
      act(() => {
        p = result.current.onRemovePermission({ policyId: POLICY.id, policyPermissionId: rowA1.id });
      });
      await waitFor(() => expect(port.removePolicyPermission).toHaveBeenCalledTimes(1));

      await act(async () => result.current.togglePermissionForm({ policyId: otherPolicy.id }));
      await waitFor(() => expect(result.current.permissionRows).toEqual([rowB]));

      release();
      await act(async () => {
        await p;
      });

      expect(result.current.permissionPolicyId).toBe(otherPolicy.id);
      expect(result.current.permissionRows).toEqual([rowB]);
      expect(result.current.permissionRows.every((row) => row.policyId === otherPolicy.id)).toBe(true);
    });

    it("togglePermissionForm fires exactly one list request per open, even under Strict Mode", async () => {
      const port = createFakeRolesPort({}, { roles: [ROLE], policies: [POLICY] });
      const listSpy = vi.spyOn(port, "listPolicyPermissions");
      function strictWrapper({ children }: { children: React.ReactNode }) {
        return (
          <StrictMode>
            <FetchQueryProvider>{children}</FetchQueryProvider>
          </StrictMode>
        );
      }
      const { result } = renderHook(() => useRoles({ port, translate, queryScope: "w1" }), { wrapper: strictWrapper });
      await waitFor(() => expect(result.current.roles).not.toBeNull());

      await act(async () => result.current.togglePermissionForm({ policyId: POLICY.id }));
      await waitFor(() => expect(result.current.permissionPolicyId).toBe(POLICY.id));

      expect(listSpy).toHaveBeenCalledTimes(1);
    });
  });
});
