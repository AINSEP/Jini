import { useRef, useState } from "react";
import type { AdminIdentityUser } from "../../models.js";
import { KEYS } from "../rules.js";
import type { UsersDependencies } from "./use-users.hooks.js";
import { useAsyncAction as useAsyncActionDefault, useFetchMutation as useFetchMutationDefault } from "../../kit.js";

export function useUsersCreationState({ port, queryScope }: Pick<UsersDependencies, 'port' | 'queryScope'>, { useAsyncAction = useAsyncActionDefault, useFetchMutation = useFetchMutationDefault }: { useAsyncAction?: typeof useAsyncActionDefault; useFetchMutation?: typeof useFetchMutationDefault } = {}) {
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

  return { formOpen, setFormOpen, username, setUsername, email, setEmail, password, setPassword, createUser, createUserMutation };
}

export function useUsersGrantState({ port, queryScope }: Pick<UsersDependencies, 'port' | 'queryScope'>, { useFetchMutation = useFetchMutationDefault }: { useFetchMutation?: typeof useFetchMutationDefault } = {}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Bumped once per `toggleExpanded` call, regardless of which panel — `runGrantMutation` (a
  // top-level function, outside this closure's re-render cycle) reads this to tell whether the
  // operator switched panels AT ALL while its own grant was in flight. See that function's own doc
  // comment for why this counts switches rather than comparing against `expandedId`'s value.
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
  return { expandedId, setExpandedId, toggleGenerationRef, pendingRoleId, setPendingRoleId, pendingPolicyId, setPendingPolicyId, grantSaving, setGrantSaving, grantError, setGrantError, assignRoleMutation, attachPolicyMutation, editEmail, setEditEmail, updateEmailMutation };
}

export function useUsersStatusState({ port, queryScope }: Pick<UsersDependencies, 'port' | 'queryScope'>, { useAsyncAction = useAsyncActionDefault, useFetchMutation = useFetchMutationDefault }: { useAsyncAction?: typeof useAsyncActionDefault; useFetchMutation?: typeof useFetchMutationDefault } = {}) {
  const [toggleSavingId, setToggleSavingId] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const toggleStatusMutation = useFetchMutation({
    run: ({ input: user }: { input: AdminIdentityUser }) => (user.status === "active" ? port.disableUser({ principalId: user.principalId }) : port.enableUser({ principalId: user.principalId }))
  }, {
    invalidates: [[queryScope, ...KEYS.list]],
  });

  // Disable now confirms via a `RowMenu` item -> `ConfirmDialog` modal (replacing the in-place
  // two-click `ConfirmButton`, which has no menu-item equivalent — same migration the host app's src/features/posts/Posts.tsx and
  // packages/admin/src/redirects/react/pages/RedirectsPage.tsx already made). `null` when the dialog is closed.
  const [confirmingDisable, setConfirmingDisable] = useState<AdminIdentityUser | null>(null);

  // Reset password moved out of the expanded "Manage" panel into its own `RowMenu` item, which
  // opens this dialog (it needs a text field, so it's a `ConfirmDialog` with an input in the body,
  // not a plain confirm). Kept open on failure (unlike the delete-style dialogs above, which close
  // either way) so a failed attempt doesn't discard the password the operator just typed.
  const [resetPasswordFor, setResetPasswordFor] = useState<AdminIdentityUser | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const resetPassword = useAsyncAction();

  return { toggleSavingId, setToggleSavingId, toggleError, setToggleError, notice, setNotice, toggleStatusMutation, confirmingDisable, setConfirmingDisable, resetPasswordFor, setResetPasswordFor, newPassword, setNewPassword, resetPassword };
}
