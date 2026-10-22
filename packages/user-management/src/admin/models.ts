import type { RoleRecord, PolicyRecord, PolicyPermissionRecord } from '../core/types.js';
/** Reuse domain records without importing browser or server DTO implementations. */
export interface RolesState {
    readonly roles: readonly RoleRecord[] | null;
    readonly policies: readonly PolicyRecord[] | null;
    readonly error: string | null;
    readonly rowError: string | null;
    readonly roleError: string | null;
    readonly policyError: string | null;
    readonly roleName: string;
    readonly policyName: string;
    readonly policyDescription: string;
    readonly roleSaving: boolean;
    readonly policySaving: boolean;
    readonly rowSavingId: string | null;
    readonly editingRoleId: string | null;
    readonly editingRoleName: string;
    readonly editingPolicyId: string | null;
    readonly editingPolicyName: string;
    readonly editingPolicyDescription: string;
    readonly permissionPolicyId: string | null;
    readonly permissionInput: string;
    readonly resourceTypeInput: string;
    readonly permissionRows: readonly PolicyPermissionRecord[];
    readonly permissionsLoading: boolean;
    readonly removingPermissionId: string | null;
    readonly pending: DestructiveTarget | null;
    readonly confirming: boolean;
}
export type DestructiveTarget = {
    readonly kind: 'role';
    readonly role: RoleRecord;
} | {
    readonly kind: 'policy';
    readonly policy: PolicyRecord;
} | {
    readonly kind: 'permission';
    readonly policyId: string;
    readonly row: PolicyPermissionRecord;
};
export type RolesDraft = Pick<RolesState, 'roleName' | 'policyName' | 'policyDescription' | 'editingRoleName' | 'editingPolicyName' | 'editingPolicyDescription' | 'permissionInput' | 'resourceTypeInput'>;
export type { RoleRecord, PolicyRecord, PolicyPermissionRecord } from '../core/types.js';

/** Safe administration projections: credentials and session tokens never enter snapshots. */
export interface AdminAccount {
  id: string;
  username: string;
}
export interface AdminOperator {
  principalId: string;
  workspaceId: string;
  username: string;
  email?: string | undefined;
  status: 'active' | 'disabled';
  createdAt: string;
  lastLoginAt?: string | undefined;
  roleIds: readonly string[];
  policyIds: readonly string[];
}
export interface AdminMember {
  id: string;
  workspaceId: string;
  email: string;
  name?: string | undefined;
  status: 'pending' | 'active' | 'disabled';
  emailVerifiedAt?: string | undefined;
  createdAt: string;
  updatedAt: string;
  version: number;
}
export interface CallerInfo {
  user: AdminAccount;
  effectivePermissions?: readonly string[];
  canManageUserTrash?: boolean;
}
export type UserAction = 'email' | 'grants' | 'disable' | 'enable' | 'reset' | 'delete';
export interface UsersDraft {
  username: string; email: string; password: string;
  editEmail: string; pendingRoleId: string; pendingPolicyId: string;
  newPassword: string; confirmPassword: string;
}
export interface UsersState extends UsersDraft {
  readonly users: readonly AdminOperator[] | null;
  readonly roles: readonly RoleRecord[] | null;
  readonly policies: readonly PolicyRecord[] | null;
  readonly caller: CallerInfo | null;
  readonly error: string | null; readonly rowError: string | null; readonly formError: string | null;
  readonly grantError: string | null; readonly passwordError: string | null; readonly notice: string | null;
  readonly formOpen: boolean; readonly saving: boolean; readonly grantSaving: boolean;
  readonly expandedId: string | null; readonly rowSavingId: string | null;
  readonly pending: { readonly kind: 'disable' | 'delete' | 'reset'; readonly user: AdminOperator } | null;
  readonly confirming: boolean;
  readonly showNewPassword: boolean; readonly showConfirmPassword: boolean;
}
export interface MemberRowState {
  readonly disabling: boolean; readonly resending: boolean;
  readonly error: string | null; readonly notice: string | null;
}
export interface MembersState {
  readonly members: readonly AdminMember[] | null; readonly error: string | null;
  readonly rows: Readonly<Record<string, MemberRowState>>;
  readonly expandedId: string | null; readonly detailById: Readonly<Record<string, AdminMember>>;
  readonly detailError: string | null; readonly detailLoadingId: string | null;
  readonly pending: AdminMember | null; readonly confirming: boolean;
}
export interface AuthState {
  readonly username: string; readonly password: string;
  readonly error: string | null; readonly busy: boolean;
}
