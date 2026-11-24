import type { FetchQueryAdapter } from "@jini-ai/core/fetch";
import { useAdminKitValues } from "../../../react/kit.js";
import type { SecurityPermissionsPort } from "./security-permissions-port.hooks.js";

/** What the Security page needs to know about the current person's permissions. */
export interface SecurityPermissionsController {
  /** `false` while the permissions read is unsettled or failed — denied until proven allowed. */
  readonly canManageSiteKey: boolean;
}

// Namespaced under "security" — same convention the access-tokens reads use for their own list reads,
// and the comments module's `KEYS.permissions` uses for this exact same `/auth/me` read.
const SECURITY_PERMISSIONS_KEY = ["security", "permissions"] as const;

/**
 * Whether the signed-in person holds the host's site-key management permission, read once through the
 * port's `me`. The permission string is the host's policy, so the caller passes it in.
 * @example const { canManageSiteKey } = useSecurityPermissions({ port, permission: "admin.security.site-key.manage", useFetchQuery });
 */
export function useSecurityPermissions({ port, permission, useFetchQuery }: { port: SecurityPermissionsPort; permission: string; useFetchQuery: FetchQueryAdapter["useFetchQuery"] }, _optional: Record<string, never> = {}): SecurityPermissionsController {
  const { hasPermission } = useAdminKitValues();
  const query = useFetchQuery({ key: SECURITY_PERMISSIONS_KEY, fetch: () => port.me() });
  const canManageSiteKey = hasPermission({ permissions: query.data?.effectivePermissions ?? [], permission });
  return { canManageSiteKey };
}
