import type { UsersController } from "./use-users.hooks.js";
import type { useUsersState } from "./use-users-state.hooks.js";
import type { createUsersPanelActions, createUsersGrantActions } from "./users-grant-actions.js";
import type { createUsersDisableActions, useUsersDeletion } from "./use-users-status.hooks.js";

export function createUsersController(
  state: ReturnType<typeof useUsersState>,
  actions: ReturnType<typeof createUsersPanelActions> & ReturnType<typeof createUsersGrantActions> &
    ReturnType<typeof createUsersDisableActions> & ReturnType<typeof useUsersDeletion> & {
      onCreate: UsersController['onCreate']; openResetPassword: UsersController['openResetPassword'];
      confirmResetPassword: UsersController['confirmResetPassword']; onToggleStatus: UsersController['onToggleStatus'];
    },
): UsersController {
  const {
    users, roles, policies, canGrant, error, formOpen, setFormOpen, username, setUsername, email, setEmail,
    password, setPassword, createUser, expandedId, pendingRoleId, setPendingRoleId, pendingPolicyId,
    setPendingPolicyId, grantSaving, grantError, editEmail, setEditEmail, toggleSavingId, toggleError,
    notice, confirmingDisable, setConfirmingDisable, resetPasswordFor, setResetPasswordFor, newPassword,
    setNewPassword, resetPassword, canManageUserTrash, rowCapabilities, ownProfile, canRenameUser,
    canRenameOwnProfile, openOwnRename, renameUserHandler, changeUsername, translate,
  } = state;
  const {
    onCreate, toggleExpanded, onAssignRole, onAttachPolicy, emailSaving, onSaveEmail, requestDisable,
    confirmDisable, onToggleStatus, openResetPassword, confirmResetPassword, confirmingDelete,
    setConfirmingDelete, requestDelete, deleteUserMutation, confirmDelete,
  } = actions;
  return {
    users, roles, policies, canGrant, error,

    formOpen, setFormOpen, username, setUsername,
    email, setEmail, password, setPassword,
    saving: createUser.saving,
    formError: createUser.error,
    onCreate,

    expandedId, toggleExpanded, pendingRoleId, setPendingRoleId,
    pendingPolicyId, setPendingPolicyId, grantSaving, grantError,
    onAssignRole, onAttachPolicy,

    editEmail, setEditEmail, emailSaving, onSaveEmail,

    toggleSavingId, toggleError, notice,

    confirmingDisable, setConfirmingDisable, requestDisable, confirmDisable, onToggleStatus,

    resetPasswordFor, setResetPasswordFor, newPassword, setNewPassword,
    passwordSaving: resetPassword.saving,
    passwordError: resetPassword.error,
    setPasswordError: resetPassword.setError,
    openResetPassword, confirmResetPassword,

    canManageUserTrash, rowCapabilities, ownProfile, canRenameUser,
    canRenameOwnProfile, openOwnRename, renameUserHandler, changeUsername,
    confirmingDelete, setConfirmingDelete, requestDelete,
    deleteSaving: deleteUserMutation.status === "pending", confirmDelete,

    t: translate, translate,
  };
}
