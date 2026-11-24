import type { RolesController } from "./use-roles.hooks.js";

export function createRolesController(
  {
    roles, policies, error, rowError, roleName, setRoleName, roleSaving, roleError, onCreateRole, policyName, setPolicyName, policyDescription,
    setPolicyDescription, policySaving, policyError, onCreatePolicy, editingRoleId, setEditingRoleId, editingRoleName, setEditingRoleName, startEditRole,
    onSaveRole, editingPolicyId, setEditingPolicyId, editingPolicyName, setEditingPolicyName, editingPolicyDescription, setEditingPolicyDescription,
    startEditPolicy, onSavePolicy, rowSavingId, permissionPolicyId, permissionInput, setPermissionInput, resourceTypeInput, setResourceTypeInput,
    togglePermissionForm, onWritePermission, permissionRows, permissionsLoading, removingPermissionId, onRemovePermission, pendingPermissionRemove,
    setPendingPermissionRemove, onConfirmRemovePermission, pendingRoleDelete, setPendingRoleDelete, onDeleteRole, pendingPolicyDelete, setPendingPolicyDelete,
    onDeletePolicy, boundT, locale,
  }:
    Omit<RolesController, "t"> & { boundT: RolesController["t"] }
) : RolesController {
  return {
    roles,
    policies,
    error,
    rowError,
    ...createRoleCreationControllers({
      roleName, setRoleName, roleSaving, roleError, onCreateRole, policyName, setPolicyName, policyDescription, setPolicyDescription, policySaving,
      policyError, onCreatePolicy,
    }),
    ...createRoleEditingControllers({
      editingRoleId, setEditingRoleId, editingRoleName, setEditingRoleName, startEditRole, onSaveRole, editingPolicyId, setEditingPolicyId, editingPolicyName,
      setEditingPolicyName, editingPolicyDescription, setEditingPolicyDescription, startEditPolicy, onSavePolicy,
    }),

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
    locale,
  };
}

function createRoleEditingControllers(
  {
    editingRoleId, setEditingRoleId, editingRoleName, setEditingRoleName, startEditRole, onSaveRole, editingPolicyId, setEditingPolicyId, editingPolicyName,
    setEditingPolicyName, editingPolicyDescription, setEditingPolicyDescription, startEditPolicy, onSavePolicy,
  }:
    Pick<RolesController, "editingRoleId" | "setEditingRoleId" | "editingRoleName" | "setEditingRoleName" | "startEditRole" | "onSaveRole" | "editingPolicyId" | "setEditingPolicyId" | "editingPolicyName" | "setEditingPolicyName" | "editingPolicyDescription" | "setEditingPolicyDescription" | "startEditPolicy" | "onSavePolicy">
): Pick<RolesController, "editingRoleId" | "setEditingRoleId" | "editingRoleName" | "setEditingRoleName" | "startEditRole" | "onSaveRole" | "editingPolicyId" | "setEditingPolicyId" | "editingPolicyName" | "setEditingPolicyName" | "editingPolicyDescription" | "setEditingPolicyDescription" | "startEditPolicy" | "onSavePolicy"> {
  return {

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
  };
}

function createRoleCreationControllers(
  {
    roleName, setRoleName, roleSaving, roleError, onCreateRole, policyName, setPolicyName, policyDescription, setPolicyDescription, policySaving, policyError,
    onCreatePolicy,
  }:
    Pick<RolesController, "roleName" | "setRoleName" | "roleSaving" | "roleError" | "onCreateRole" | "policyName" | "setPolicyName" | "policyDescription" | "setPolicyDescription" | "policySaving" | "policyError" | "onCreatePolicy">
): Pick<RolesController, "roleName" | "setRoleName" | "roleSaving" | "roleError" | "onCreateRole" | "policyName" | "setPolicyName" | "policyDescription" | "setPolicyDescription" | "policySaving" | "policyError" | "onCreatePolicy"> {
  return {

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
  };
}
