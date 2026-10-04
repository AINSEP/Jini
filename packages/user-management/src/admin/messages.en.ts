export const rolesMessagesEn = Object.freeze({
    title: 'Roles & Permissions', roles: 'Roles', policies: 'Policies', people: 'People',
    description: 'Define roles and policies here. Assign them to people in Users.',
    loading: 'Loading roles & permissions…', readOnly: 'Read-only: managing roles requires role.manage.',
    forbidden: 'You do not have permission to do that.', conflict: 'It is still in use — remove that assignment/attachment first.',
    unknownPermission: 'That permission is not recognized.', exceedsIssuer: 'You cannot grant a permission you do not hold.',
    validation: 'Please correct the highlighted fields.', immutable: 'Built-in roles and built-in or frozen policies cannot be changed.',
});

export const usersMessagesEn = {
  title: 'Users', description: 'Operator accounts with access to this admin — assign roles and policies, or disable access.',
  loading: 'Loading users…', readOnly: 'Read-only — user administration is unavailable with your current grants.',
  passwordHelp: "No 'forgot password' email yet. If someone is locked out, the owner can reset their password here.",
  protected: 'Only an owner can modify an owner. Unresolved owner status prevents changes.',
  forbidden: 'You do not have permission to do that.',
} as const;
export const membersMessagesEn = {
  title: 'Members', description: 'People who have registered an account — review status, resend a sign-in link, or disable access.',
  loading: 'Loading members…', readOnly: 'Read-only — member actions require member.manage.',
} as const;
export const authMessagesEn = { title: 'Sign in to your workspace', submit: 'Sign in', busy: 'Signing in…', failed: 'login failed' } as const;
