import type { RoleRecord, PolicyRecord, DestructiveTarget } from './models.js';
import { rolesMessagesEn as m } from './messages.en.js';
/** All writes share the actual server vocabulary. A missing grant is a denial. */
export function canManageRoles({ permissions }: {
    permissions: readonly string[];
}, _optional: Record<string, never> = {}): boolean {
    return permissions.includes('role.manage') || permissions.includes('*');
}
export function mutableRole({ role }: {
    role: RoleRecord;
}, _optional: Record<string, never> = {}): boolean { return !role.isBuiltin; }
export function mutablePolicy({ policy }: {
    policy: PolicyRecord;
}, _optional: Record<string, never> = {}): boolean { return !policy.isBuiltin && !policy.isFrozen; }
/** Conflict copy is feature-specific: references, rather than duplicate workspace slugs. */
export function describeRolesError({ error, fallback }: {
    error: unknown;
    fallback: string;
}, _optional: Record<string, never> = {}): string {
    const messages: Readonly<Record<string, string>> = {
        FORBIDDEN: m.forbidden, RESOURCE_CONFLICT: m.conflict, PERMISSION_UNKNOWN: m.unknownPermission,
        GRANT_EXCEEDS_ISSUER: m.exceedsIssuer,
    };
    if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
        if (error.code === 'VALIDATION_ERROR')
            return error instanceof Error && error.message ? error.message : m.validation;
        if (messages[error.code])
            return messages[error.code]!;
    }
    return error instanceof Error && error.message ? error.message : fallback;
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
