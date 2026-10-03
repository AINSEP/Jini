import { interpolate } from "@jini-ai/ui/panel-kit";
import type { Translate } from "@jini-ai/ui/panel-kit";
import { useEffect, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from "react";

import { type AdminIdentityUser, type AdminPolicy, type AdminRole } from "../../models.js";
import { useFetchMutation, useFetchQuery } from "@jini-ai/ui/panel-kit";
import { useAsyncAction } from "@jini-ai/ui/panel-kit";
import { describeApiError as describeFeatureError, KEYS } from "../rules.js";
import type { UsersPort } from "../../ports.js";

export interface UsersController {

  users: AdminIdentityUser[] | null;
  roles: AdminRole[] | null;
  policies: AdminPolicy[] | null;
  error: string | null;

  formOpen: boolean;
  setFormOpen: Dispatch<SetStateAction<boolean>>;
  username: string;
  setUsername: Dispatch<SetStateAction<string>>;
  email: string;
  setEmail: Dispatch<SetStateAction<string>>;
  password: string;
  setPassword: Dispatch<SetStateAction<string>>;
  saving: boolean;
  formError: string | null;
  onCreate: (e: FormEvent) => Promise<void>;

  expandedId: string | null;
  toggleExpanded: (user: AdminIdentityUser) => void;
  pendingRoleId: string;
  setPendingRoleId: Dispatch<SetStateAction<string>>;
  pendingPolicyId: string;
  setPendingPolicyId: Dispatch<SetStateAction<string>>;
  grantSaving: boolean;
  grantError: string | null;
  onAssignRole: (required: { principalId: string }) => Promise<void>;
  onAttachPolicy: (required: { principalId: string }) => Promise<void>;

  editEmail: string;
  setEditEmail: Dispatch<SetStateAction<string>>;
  emailSaving: boolean;
  onSaveEmail: (required: { principalId: string }) => Promise<void>;

  toggleSavingId: string | null;
  toggleError: string | null;
  notice: string | null;

  confirmingDisable: AdminIdentityUser | null;
  setConfirmingDisable: Dispatch<SetStateAction<AdminIdentityUser | null>>;

  requestDisable: (user: AdminIdentityUser) => void;
  confirmDisable: () => Promise<void>;
  onToggleStatus: (user: AdminIdentityUser) => Promise<void>;

  resetPasswordFor: AdminIdentityUser | null;
  setResetPasswordFor: Dispatch<SetStateAction<AdminIdentityUser | null>>;
  newPassword: string;
  setNewPassword: Dispatch<SetStateAction<string>>;
  passwordSaving: boolean;
  passwordError: string | null;
  setPasswordError: Dispatch<SetStateAction<string | null>>;
  openResetPassword: (user: AdminIdentityUser) => void;
  confirmResetPassword: () => Promise<void>;

  canManageUserTrash: boolean;

  confirmingDelete: AdminIdentityUser | null;
  setConfirmingDelete: Dispatch<SetStateAction<AdminIdentityUser | null>>;

  requestDelete: (user: AdminIdentityUser) => void;

  deleteSaving: boolean;
  confirmDelete: () => Promise<void>;

  t: (key: string) => string;

  translate: Translate;
}

async function runGrantMutation(
  generationAtStart: number,
  toggleGenerationRef: { current: number },
  mutate: () => Promise<unknown>,
  onSuccess: () => void,
  setGrantSaving: Dispatch<SetStateAction<boolean>>,
  setGrantError: Dispatch<SetStateAction<string | null>>,
  describeError: (e: unknown) => string,
): Promise<void> {
  setGrantSaving(true);
  setGrantError(null);
  try {
    await mutate();
    if (toggleGenerationRef.current === generationAtStart) onSuccess();
  } catch (e) {

    if (toggleGenerationRef.current === generationAtStart) setGrantError(describeError(e));
  } finally {

    if (toggleGenerationRef.current === generationAtStart) setGrantSaving(false);
  }
}

export interface UsersDependencies { port: UsersPort; translate: Translate; queryScope: string }
export interface UsersOptions {
 openOwnPasswordReset?: boolean | undefined;
 onOwnPasswordResetClosed?: (() => void) | undefined;
}

export function useUsers({ port, translate, queryScope }: UsersDependencies, { openOwnPasswordReset = false, onOwnPasswordResetClosed }: UsersOptions = {}): UsersController {
  const describeApiError = (error: unknown, fallback: string) => describeFeatureError({ error, fallback, translate });
  const t = translate;
  const boundT = translate;

  const portRef = useRef(port);

  const list = useFetchQuery({
    key: [queryScope, ...KEYS.list],
    fetch: async () => {
      const [u, r, p] = await Promise.all([port.listUsers({}), port.listRoles({}), port.listPolicies({})]);
      return { users: u.users, roles: r.roles, policies: p.policies };
    },
  });
  const users = list.data?.users ?? null;
  const roles = list.data?.roles ?? null;
  const policies = list.data?.policies ?? null;
  const error = list.error ? describeApiError(list.error, t("failed to load users")) : null;

  const [formOpen, setFormOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const createUser = useAsyncAction();
  const createUserMutation = useFetchMutation({
    run: ({ input }: { input: { username: string; password: string; email: string | undefined } }) =>
      port.createUser({ username: input.username, password: input.password }, { email: input.email })
  }, {
    invalidates: [[queryScope, ...KEYS.list]],
  });

  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggleGenerationRef = useRef(0);
  const [pendingRoleId, setPendingRoleId] = useState("");
  const [pendingPolicyId, setPendingPolicyId] = useState("");
  const [grantSaving, setGrantSaving] = useState(false);
  const [grantError, setGrantError] = useState<string | null>(null);
  const assignRoleMutation = useFetchMutation({
    run: ({ input }: { input: { principalId: string; roleId: string } }) => port.assignRole(input)
  }, {
    invalidates: [[queryScope, ...KEYS.list]],
  });
  const attachPolicyMutation = useFetchMutation({
    run: ({ input }: { input: { principalId: string; policyId: string } }) => port.attachPolicy(input)
  }, {
    invalidates: [[queryScope, ...KEYS.list]],
  });

  const [editEmail, setEditEmail] = useState("");
  const updateEmailMutation = useFetchMutation({
    run: ({ input }: { input: { principalId: string; email: string } }) => port.updateUser({ principalId: input.principalId }, { email: input.email })
  }, {
    invalidates: [[queryScope, ...KEYS.list]],
  });
  const [toggleSavingId, setToggleSavingId] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const toggleStatusMutation = useFetchMutation({
    run: ({ input: user }: { input: AdminIdentityUser }) => (user.status === "active" ? port.disableUser({ principalId: user.principalId }) : port.enableUser({ principalId: user.principalId }))
  }, {
    invalidates: [[queryScope, ...KEYS.list]],
  });

  const [confirmingDisable, setConfirmingDisable] = useState<AdminIdentityUser | null>(null);

  const [resetPasswordFor, setResetPasswordFor] = useState<AdminIdentityUser | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const resetPassword = useAsyncAction();

  const [ownPrincipalId, setOwnPrincipalId] = useState<string | null>(null);

  const [canManageUserTrash, setCanManageUserTrash] = useState(false);
  useEffect(() => {
    let cancelled = false;
    portRef.current
      .me({})
      .then((res) => {
        if (!cancelled) {
          setOwnPrincipalId(res.user.id);
          setCanManageUserTrash(res.canManageUserTrash);
        }
      })
      .catch(() => {

      });
    return () => {
      cancelled = true;
    };
  }, []);

  const deepLinkAttemptedRef = useRef(false);

  const openedViaDeepLinkRef = useRef(false);
  useEffect(() => {
    if (!openOwnPasswordReset || deepLinkAttemptedRef.current) return;
    if (!users || ownPrincipalId === null) return;
    const ownRow = users.find((u) => u.principalId === ownPrincipalId);
    if (!ownRow) return;
    deepLinkAttemptedRef.current = true;
    openedViaDeepLinkRef.current = true;
    openResetPassword(ownRow);
  }, [openOwnPasswordReset, users, ownPrincipalId]);

  useEffect(() => {
    if (resetPasswordFor !== null || !openedViaDeepLinkRef.current) return;
    openedViaDeepLinkRef.current = false;
    onOwnPasswordResetClosed?.();
  }, [resetPasswordFor, onOwnPasswordResetClosed]);

  const resetPasswordMutation = useFetchMutation({
    run: ({ input }: { input: { principalId: string; password: string } }) => port.resetUserPassword(input),
  });

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    await createUser.run({ action: async () => {
      await createUserMutation.mutate({ input: { username, password, email: email || undefined } });
      setUsername("");
      setEmail("");
      setPassword("");
      setFormOpen(false);
    }, describeError: (e) => describeApiError(e, t("failed to create user")) });
  }

  function toggleExpanded(user: AdminIdentityUser) {
    setGrantError(null);

    setGrantSaving(false);
    setPendingRoleId("");
    setPendingPolicyId("");
    setEditEmail(user.email ?? "");
    toggleGenerationRef.current += 1;
    setExpandedId((current) => (current === user.principalId ? null : user.principalId));
  }

  async function onAssignRole({ principalId }: { principalId: string }) {
    if (!pendingRoleId) return;
    await runGrantMutation(
      toggleGenerationRef.current,
      toggleGenerationRef,
      () => assignRoleMutation.mutate({ input: { principalId, roleId: pendingRoleId } }),
      () => setPendingRoleId(""),
      setGrantSaving,
      setGrantError,
      (e) => describeApiError(e, t("failed to assign role")),
    );
  }

  async function onAttachPolicy({ principalId }: { principalId: string }) {
    if (!pendingPolicyId) return;
    await runGrantMutation(
      toggleGenerationRef.current,
      toggleGenerationRef,
      () => attachPolicyMutation.mutate({ input: { principalId, policyId: pendingPolicyId } }),
      () => setPendingPolicyId(""),
      setGrantSaving,
      setGrantError,
      (e) => describeApiError(e, t("failed to attach policy")),
    );
  }

  async function onSaveEmail({ principalId }: { principalId: string }) {
    setGrantError(null);
    try {
      await updateEmailMutation.mutate({ input: { principalId, email: editEmail } });
    } catch (e) {
      setGrantError(describeApiError(e, t("failed to update email")));
    }
  }
  const emailSaving = updateEmailMutation.status === "pending";

  function openResetPassword(user: AdminIdentityUser) {
    if (toggleSavingId || resetPassword.saving) return;
    resetPassword.setError(null);
    setNewPassword("");
    setResetPasswordFor(user);
  }

  async function confirmResetPassword() {
    if (!resetPasswordFor || !newPassword) return;

    await resetPassword.run({ action: async () => {
      await resetPasswordMutation.mutate({ input: { principalId: resetPasswordFor.principalId, password: newPassword } });

      setNotice(
        resetPasswordFor.principalId === ownPrincipalId
          ? t("Password changed. Sign in again with your new password.")
          : interpolate({ template: t('Password reset for "{username}" — every active session for this user was revoked.'), vars: { username: resetPasswordFor.username } }),
      );
      setResetPasswordFor(null);
      setNewPassword("");
    }, describeError: (e) => describeApiError(e, t("failed to reset password")) });
  }

  async function onToggleStatus(user: AdminIdentityUser) {
    setToggleSavingId(user.principalId);
    setToggleError(null);
    try {
      await toggleStatusMutation.mutate({ input: user });
    } catch (e) {
      setToggleError(describeApiError(e, t("failed to change status")));
    } finally {
      setToggleSavingId((current) => (current === user.principalId ? null : current));
    }
  }

  function requestDisable(user: AdminIdentityUser) {
    setToggleError(null);
    setConfirmingDisable(user);
  }

  async function confirmDisable() {
    if (!confirmingDisable) return;
    const user = confirmingDisable;
    await onToggleStatus(user);
    setConfirmingDisable((current) => (current?.principalId === user.principalId ? null : current));
  }

  const deleteUserMutation = useFetchMutation({
    run: ({ input: principalId }: { input: string }) => port.deleteUser({ principalId: principalId })
  }, {
    invalidates: [[queryScope, ...KEYS.list]],
  });
  const [confirmingDelete, setConfirmingDelete] = useState<AdminIdentityUser | null>(null);

  function requestDelete(user: AdminIdentityUser) {
    setToggleError(null);
    setConfirmingDelete(user);
  }

  async function confirmDelete() {
    if (!confirmingDelete) return;
    const user = confirmingDelete;
    try {
      await deleteUserMutation.mutate({ input: user.principalId });
    } catch (e) {
      setToggleError(describeApiError(e, t("failed to delete user")));
    }
    setConfirmingDelete((current) => (current?.principalId === user.principalId ? null : current));
  }

  return {
    users,
    roles,
    policies,
    error,

    formOpen,
    setFormOpen,
    username,
    setUsername,
    email,
    setEmail,
    password,
    setPassword,
    saving: createUser.saving,
    formError: createUser.error,
    onCreate,

    expandedId,
    toggleExpanded,
    pendingRoleId,
    setPendingRoleId,
    pendingPolicyId,
    setPendingPolicyId,
    grantSaving,
    grantError,
    onAssignRole,
    onAttachPolicy,

    editEmail,
    setEditEmail,
    emailSaving,
    onSaveEmail,

    toggleSavingId,
    toggleError,
    notice,

    confirmingDisable,
    setConfirmingDisable,
    requestDisable,
    confirmDisable,
    onToggleStatus,

    resetPasswordFor,
    setResetPasswordFor,
    newPassword,
    setNewPassword,
    passwordSaving: resetPassword.saving,
    passwordError: resetPassword.error,
    setPasswordError: resetPassword.setError,
    openResetPassword,
    confirmResetPassword,

    canManageUserTrash,
    confirmingDelete,
    setConfirmingDelete,
    requestDelete,
    deleteSaving: deleteUserMutation.status === "pending",
    confirmDelete,

    t: boundT,
    translate,
  };
}

