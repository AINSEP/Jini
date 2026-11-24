import type { AdminUser } from "@jini-ai/core/contracts/site/user-management-react";

/**
 * @file What `use-login.hooks.ts` needs from the outside world, as an interface rather than a
 * direct `lib/api` import.
 *
 * Follows the `useX(dependencies)` / `useWiredX()` pair documented in
 * the host's wired-hooks convention doc (canonical spec) and
 * `../../../redirects/SOURCE-RATIONALE.md` (canonical reference implementation): this file declares,
 * the host's `login-dependencies.hooks.ts` binds the real `api` client, and nothing else in the
 * login screen imports the host's `lib/api`.
 */
export interface LoginPort {
  login(credentials: { username: string; password: string }, optional?: Record<string, never>): Promise<{ user: AdminUser } | { mfaRequired: true; pendingToken: string }>;
  completeMfa?(input: { pendingToken: string; code: string }, optional?: Record<string, never>): Promise<{ user: AdminUser }>;
}
