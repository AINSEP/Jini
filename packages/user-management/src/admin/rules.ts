import type { RoleRecord, PolicyRecord, DestructiveTarget } from './models.js';
import { rolesMessagesEn as m } from './messages.en.js';
import { hasAdminGrant } from './people.rules.js';
import { errorCode, errorMessageOr } from './error-copy.js';
/** All writes share the actual server vocabulary. A missing grant is a denial. */
export function canManageRoles({ permissions }: {
    permissions: readonly string[];
}, _optional: Record<string, never> = {}): boolean {
    return hasAdminGrant({ permissions, permission: 'role.manage' });
}
export function mutableRole({ role }: {
    role: RoleRecord;
}, _optional: Record<string, never> = {}): boolean { return !role.isBuiltin; }
export function mutablePolicy({ policy }: {
    policy: PolicyRecord;
}, _optional: Record<string, never> = {}): boolean { return !policy.isBuiltin && !policy.isFrozen; }
const ROLES_ERROR_COPY: Readonly<Record<string, string>> = Object.freeze({
    FORBIDDEN: m.forbidden, RESOURCE_CONFLICT: m.conflict, PERMISSION_UNKNOWN: m.unknownPermission,
    GRANT_EXCEEDS_ISSUER: m.exceedsIssuer,
});
/** Conflict copy is feature-specific: references, rather than duplicate workspace slugs. */
export function describeRolesError({ error, fallback }: {
    error: unknown;
    fallback: string;
}, _optional: Record<string, never> = {}): string {
    const code = errorCode({ error });
    if (code === 'VALIDATION_ERROR')
        return errorMessageOr({ error, fallback: m.validation });
    // Inherited keys resolve here (see the "reported, not fixed" pin in rules.pins.test.ts).
    if (code !== undefined && ROLES_ERROR_COPY[code])
        return ROLES_ERROR_COPY[code]!;
    return errorMessageOr({ error, fallback });
}
export function destructiveCopy({ target }: {
    target: DestructiveTarget | null;
}, _optional: Record<string, never> = {}) {
    if (target?.kind === 'permission')
        return { title: 'Remove permission?', label: 'Remove', tone: 'warning' as const,
            body: `Remove "${target.row.permission}"${target.row.resourceType ? ` (${target.row.resourceType})` : ''} from this policy? This changes live access immediately.`, consequence: 'changes live access immediately' };
    if (target?.kind === 'policy')
        return { title: 'Delete policy?', label: 'Delete', tone: 'danger' as const,
            body: `Delete "${target.policy.name}"? Policies still attached to users or roles cannot be deleted.`, consequence: 'cannot be undone' };
    return { title: 'Delete role?', label: 'Delete', tone: 'danger' as const,
        body: target?.kind === 'role' ? `Delete "${target.role.name}"? Roles still assigned to users cannot be deleted.` : '', consequence: 'cannot be undone' };
}
