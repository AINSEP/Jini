/** Default user-facing authentication copy. Hosts may replace it without changing error classes. */
export interface UserManagementMessages { invalidCredentials: string; invalidSessionTtl: string }
export const defaultUserManagementMessages: UserManagementMessages = {
  invalidSessionTtl: "sessionTtlMs must be positive and finite",
  invalidCredentials: "invalid username or password",
};
