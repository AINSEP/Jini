import type { Translate } from "@jini-ai/ui/panel-kit";
import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import { type AdminPolicy, type AdminPolicyPermission, type AdminRole } from "../../models.js";
import { useFetchMutation, useFetchQuery } from "@jini-ai/ui/panel-kit";
import { describeApiError as describeFeatureError, KEYS } from "../rules.js";
import type { RolesPort } from "../../ports.js";

export interface PendingPermissionRemove {
  policyId: string;
  row: AdminPolicyPermission;
}

export interface RolesController {
  roles: AdminRole[] | null;
  policies: AdminPolicy[] | null;
  error: string | null;
  rowError: string | null;

  roleName: string;
  setRoleName: (name: string) => void;
  roleSaving: boolean;
  roleError: string | null;
  onCreateRole: (e: React.FormEvent) => Promise<void>;

  policyName: string;
  setPolicyName: (name: string) => void;
  policyDescription: string;
  setPolicyDescription: (description: string) => void;
  policySaving: boolean;
  policyError: string | null;
  onCreatePolicy: (e: React.FormEvent) => Promise<void>;

  editingRoleId: string | null;
  setEditingRoleId: (roleId: string | null) => void;
  editingRoleName: string;
  setEditingRoleName: (name: string) => void;
  startEditRole: (role: AdminRole) => void;
  onSaveRole: (required: { roleId: string }) => Promise<void>;

  editingPolicyId: string | null;
  setEditingPolicyId: (policyId: string | null) => void;
  editingPolicyName: string;
  setEditingPolicyName: (name: string) => void;
  editingPolicyDescription: string;
  setEditingPolicyDescription: (description: string) => void;
  startEditPolicy: (policy: AdminPolicy) => void;
  onSavePolicy: (required: { policyId: string }) => Promise<void>;

  rowSavingId: string | null;

  permissionPolicyId: string | null;
  permissionInput: string;
  setPermissionInput: (permission: string) => void;
  resourceTypeInput: string;
  setResourceTypeInput: (resourceType: string) => void;
  togglePermissionForm: (required: { policyId: string }) => void;
  onWritePermission: (required: { policyId: string }) => Promise<void>;

  permissionRows: AdminPolicyPermission[];
  permissionsLoading: boolean;

  removingPermissionId: string | null;
  onRemovePermission: (required: { policyId: string; policyPermissionId: string }) => Promise<void>;

  pendingPermissionRemove: PendingPermissionRemove | null;
  setPendingPermissionRemove: (target: PendingPermissionRemove | null) => void;
  onConfirmRemovePermission: () => Promise<void>;

  pendingRoleDelete: AdminRole | null;
  setPendingRoleDelete: (role: AdminRole | null) => void;
  onDeleteRole: () => Promise<void>;

  pendingPolicyDelete: AdminPolicy | null;
  setPendingPolicyDelete: (policy: AdminPolicy | null) => void;
  onDeletePolicy: () => Promise<void>;

  t: (key: string) => string;

  translate: Translate;
}

async function runRowDelete(
  id: string,
  mutate: (id: string) => Promise<unknown>,
  setRowSavingId: Dispatch<SetStateAction<string | null>>,
  setRowError: Dispatch<SetStateAction<string | null>>,
  clearPending: () => void,
  describeError: (e: unknown) => string,
): Promise<void> {
  setRowSavingId(id);
  setRowError(null);
  try {
    await mutate(id);
  } catch (e) {
    setRowError(describeError(e));
  } finally {
    setRowSavingId((current) => (current === id ? null : current));
    clearPending();
  }
}

export interface RolesDependencies {
  port: RolesPort;
  translate: Translate;
  queryScope: string;
}

export function useRoles(deps: RolesDependencies): RolesController {
  const { port, translate, queryScope } = deps;
  const describeApiError = (error: unknown, fallback: string) => describeFeatureError({ error, fallback, translate });
  const t = translate;
  const boundT = translate;

  const list = useFetchQuery({
    key: [queryScope, ...KEYS.list],
    fetch: async () => {
      const [r, p] = await Promise.all([port.listRoles({}), port.listPolicies({})]);
      return { roles: r.roles, policies: p.policies };
    },
  });
  const roles = list.data?.roles ?? null;
  const policies = list.data?.policies ?? null;
  const error = list.error ? describeApiError(list.error, t("failed to load roles/policies")) : null;

  const [rowError, setRowError] = useState<string | null>(null);

  const [roleName, setRoleName] = useState("");
  const [policyName, setPolicyName] = useState("");
  const [policyDescription, setPolicyDescription] = useState("");

  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [editingRoleName, setEditingRoleName] = useState("");
  const [editingPolicyId, setEditingPolicyId] = useState<string | null>(null);
  const [editingPolicyName, setEditingPolicyName] = useState("");
  const [editingPolicyDescription, setEditingPolicyDescription] = useState("");
  const [rowSavingId, setRowSavingId] = useState<string | null>(null);

  const [permissionPolicyId, setPermissionPolicyId] = useState<string | null>(null);
  const [permissionInput, setPermissionInput] = useState("");
  const [resourceTypeInput, setResourceTypeInput] = useState("");
  const [permissionRows, setPermissionRows] = useState<AdminPolicyPermission[]>([]);
  const [permissionsLoading, setPermissionsLoading] = useState(false);
  const [removingPermissionId, setRemovingPermissionId] = useState<string | null>(null);

  const permissionsGenerationRef = useRef(0);

  const permissionPolicyIdRef = useRef<string | null>(null);

  const [pendingRoleDelete, setPendingRoleDelete] = useState<AdminRole | null>(null);
  const [pendingPolicyDelete, setPendingPolicyDelete] = useState<AdminPolicy | null>(null);
  const [pendingPermissionRemove, setPendingPermissionRemove] = useState<PendingPermissionRemove | null>(null);

  const createRoleMutation = useFetchMutation({
    run: ({ input: name }: { input: string }) => port.createRole({ name: name })
  }, {
    invalidates: [[queryScope, ...KEYS.list]],
  });
  const createPolicyMutation = useFetchMutation({
    run: ({ input }: { input: { name: string; description: string | undefined } }) =>
      port.createPolicy({ name: input.name }, { description: input.description })
  }, {
    invalidates: [[queryScope, ...KEYS.list]],
  });
  const saveRoleMutation = useFetchMutation({
    run: ({ input }: { input: { roleId: string; name: string } }) => port.updateRole(input)
  }, {
    invalidates: [[queryScope, ...KEYS.list]],
  });
  const deleteRoleMutation = useFetchMutation({
    run: ({ input: id }: { input: string }) => port.deleteRole({ roleId: id })
  }, {
    invalidates: [[queryScope, ...KEYS.list]],
  });
  const savePolicyMutation = useFetchMutation({
    run: ({ input }: { input: { policyId: string; name: string; description: string } }) =>
      port.updatePolicy({ policyId: input.policyId }, { name: input.name, description: input.description })
  }, {
    invalidates: [[queryScope, ...KEYS.list]],
  });
  const deletePolicyMutation = useFetchMutation({
    run: ({ input: id }: { input: string }) => port.deletePolicy({ policyId: id })
  }, {
    invalidates: [[queryScope, ...KEYS.list]],
  });

  const writePermissionMutation = useFetchMutation({
    run: ({ input }: { input: { policyId: string; permission: string; resourceType: string | undefined } }) =>
      port.writePolicyPermission({ policyId: input.policyId, permission: input.permission }, { resourceType: input.resourceType }),
  });

  const removePermissionMutation = useFetchMutation({
    run: ({ input }: { input: { policyId: string; policyPermissionId: string } }) => port.removePolicyPermission(input),
  });

  async function onCreateRole(e: React.FormEvent) {
    e.preventDefault();
    try {
      await createRoleMutation.mutate({ input: roleName });
      setRoleName("");
    } catch {

    }
  }

  async function onCreatePolicy(e: React.FormEvent) {
    e.preventDefault();
    try {
      await createPolicyMutation.mutate({ input: { name: policyName, description: policyDescription || undefined } });
      setPolicyName("");
      setPolicyDescription("");
    } catch {

    }
  }

  function startEditRole(role: AdminRole) {
    setRowError(null);
    setEditingRoleId(role.id);
    setEditingRoleName(role.name);
  }

  async function onSaveRole({ roleId }: { roleId: string }) {
    setRowSavingId(roleId);
    setRowError(null);
    try {
      await saveRoleMutation.mutate({ input: { roleId, name: editingRoleName } });
      setEditingRoleId((current) => (current === roleId ? null : current));
    } catch (e) {
      setRowError(describeApiError(e, t("failed to rename role")));
    } finally {
      setRowSavingId((current) => (current === roleId ? null : current));
    }
  }

  async function onDeleteRole() {
    if (!pendingRoleDelete) return;
    const role = pendingRoleDelete;
    await runRowDelete(
      role.id,
      (id) => deleteRoleMutation.mutate({ input: id }),
      setRowSavingId,
      setRowError,
      () => setPendingRoleDelete((current) => (current?.id === role.id ? null : current)),
      (e) => describeApiError(e, t("failed to delete role")),
    );
  }

  function startEditPolicy(policy: AdminPolicy) {
    setRowError(null);
    setEditingPolicyId(policy.id);
    setEditingPolicyName(policy.name);
    setEditingPolicyDescription(policy.description ?? "");
  }

  async function onSavePolicy({ policyId }: { policyId: string }) {
    setRowSavingId(policyId);
    setRowError(null);
    try {
      await savePolicyMutation.mutate({ input: { policyId, name: editingPolicyName, description: editingPolicyDescription } });
      setEditingPolicyId((current) => (current === policyId ? null : current));
    } catch (e) {
      setRowError(describeApiError(e, t("failed to update policy")));
    } finally {
      setRowSavingId((current) => (current === policyId ? null : current));
    }
  }

  async function onDeletePolicy() {
    if (!pendingPolicyDelete) return;
    const policy = pendingPolicyDelete;
    await runRowDelete(
      policy.id,
      (id) => deletePolicyMutation.mutate({ input: id }),
      setRowSavingId,
      setRowError,
      () => setPendingPolicyDelete((current) => (current?.id === policy.id ? null : current)),
      (e) => describeApiError(e, t("failed to delete policy")),
    );
  }

  async function loadPermissions(policyId: string) {
    const generation = ++permissionsGenerationRef.current;
    setPermissionsLoading(true);
    try {
      const { policyPermissions } = await port.listPolicyPermissions({ policyId: policyId });

      if (permissionsGenerationRef.current !== generation) return;
      setPermissionRows(policyPermissions);
    } catch (e) {
      if (permissionsGenerationRef.current !== generation) return;
      setPermissionRows([]);
      setRowError(describeApiError(e, t("failed to load permissions")));
    } finally {
      if (permissionsGenerationRef.current !== generation) return;
      setPermissionsLoading(false);
    }
  }

  function togglePermissionForm({ policyId }: { policyId: string }) {
    setRowError(null);
    setPermissionInput("");
    setResourceTypeInput("");
    const closing = permissionPolicyIdRef.current === policyId;
    permissionPolicyIdRef.current = closing ? null : policyId;
    setPermissionPolicyId(permissionPolicyIdRef.current);

    setPermissionRows([]);
    if (!closing) void loadPermissions(policyId);
  }

  async function onRemovePermission({ policyId, policyPermissionId }: { policyId: string; policyPermissionId: string }) {
    setRemovingPermissionId(policyPermissionId);
    setRowError(null);
    try {
      await removePermissionMutation.mutate({ input: { policyId, policyPermissionId } });

      if (permissionPolicyIdRef.current === policyId) await loadPermissions(policyId);
    } catch (e) {
      setRowError(describeApiError(e, t("failed to remove permission")));
    } finally {

      setRemovingPermissionId((current) => (current === policyPermissionId ? null : current));
    }
  }

  async function onConfirmRemovePermission() {
    if (!pendingPermissionRemove) return;
    const target = pendingPermissionRemove;
    try {
      await onRemovePermission({ policyId: target.policyId, policyPermissionId: target.row.id });
    } finally {
      setPendingPermissionRemove((current) => (current?.row.id === target.row.id ? null : current));
    }
  }

  async function onWritePermission({ policyId }: { policyId: string }) {
    if (!permissionInput) return;
    const generationAtStart = permissionsGenerationRef.current;
    setRowSavingId(policyId);
    setRowError(null);
    try {
      await writePermissionMutation.mutate({ input: { policyId, permission: permissionInput, resourceType: resourceTypeInput || undefined } });
      if (permissionsGenerationRef.current === generationAtStart) {
        setPermissionInput("");
        setResourceTypeInput("");
      }

      if (permissionPolicyIdRef.current === policyId) await loadPermissions(policyId);
    } catch (e) {
      setRowError(describeApiError(e, t("failed to add permission")));
    } finally {
      setRowSavingId((current) => (current === policyId ? null : current));
    }
  }

  const roleSaving = createRoleMutation.status === "pending";
  const roleError = createRoleMutation.error ? describeApiError(createRoleMutation.error, t("failed to create role")) : null;
  const policySaving = createPolicyMutation.status === "pending";
  const policyError = createPolicyMutation.error
    ? describeApiError(createPolicyMutation.error, t("failed to create policy"))
    : null;

  return {
    roles,
    policies,
    error,
    rowError,

    roleName,
    setRoleName,
    roleSaving,
    roleError,
    onCreateRole,

    policyName,
    setPolicyName,
    policyDescription,
    setPolicyDescription,
    policySaving,
    policyError,
    onCreatePolicy,

    editingRoleId,
    setEditingRoleId,
    editingRoleName,
    setEditingRoleName,
    startEditRole,
    onSaveRole,

    editingPolicyId,
    setEditingPolicyId,
    editingPolicyName,
    setEditingPolicyName,
    editingPolicyDescription,
    setEditingPolicyDescription,
    startEditPolicy,
    onSavePolicy,

    rowSavingId,

    permissionPolicyId,
    permissionInput,
    setPermissionInput,
    resourceTypeInput,
    setResourceTypeInput,
    togglePermissionForm,
    onWritePermission,

    permissionRows,
    permissionsLoading,
    removingPermissionId,
    onRemovePermission,

    pendingPermissionRemove,
    setPendingPermissionRemove,
    onConfirmRemovePermission,

    pendingRoleDelete,
    setPendingRoleDelete,
    onDeleteRole,

    pendingPolicyDelete,
    setPendingPolicyDelete,
    onDeletePolicy,

    t: boundT,
    translate,
  };
}

