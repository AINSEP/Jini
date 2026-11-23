import type { ToolMetadataById } from '../tool-metadata-types.js';
import type { ToolApprovalPolicy } from '../contracts/site/tool-metadata-approval-policy.js';

/** identity registration declarations; shared placement rationale lives in the host aggregator. */
export const toolMetadata = {
  "identity_user_change_username": {
    search: {
      keywords: "username login name rename change update user account own profile",
      queries: ["Change this user's username.", "Rename my login username.", "Can you change an admin's account name?"],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "identity_policy_attach": {
    search: {
      keywords: "permission permissions policy grant allow access rule attach give",
      queries: [
        "Can you directly grant this policy to a user, no role needed?",
        "How do I attach a permission policy straight to someone's account?",
        "I want to give this user extra permissions from a policy — can I detach it later?",
        "Can I attach a policy that's more powerful than my own access?",
        "How do I grant a specific policy to one named user?",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "identity_policy_create": {
    search: {
      keywords: "permission permissions policy rule access control create allow deny",
      queries: [
        "How do I create a new permission policy?",
        "Can you set up a custom policy — does it have any permissions to start?",
        "I want to make a new policy I can attach to users later.",
        "How do I add a brand-new access policy?",
        "Can you create an empty policy for me to configure?",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "identity_policy_delete": {
    title: 'Permanently delete this access policy',
    summary: 'This permanently removes the selected access policy.',
    search: {
      keywords: "permission access rule delete remove",
      queries: [
        "Can you delete this custom policy?",
        "Why can't I remove a policy that's still attached to someone?",
        "How do I get rid of an unused permission policy?",
        "Can I delete a built-in or frozen policy?",
        "I want to clean up a policy nobody needs anymore.",
      ],
    },
    approval: { class: 'delete', confirmation: 'plan' },
  },
  "identity_policy_list": {
    search: {
      keywords: "permission access rules list existing available what policies",
      queries: [
        "What permission policies do we have set up?",
        "Can you show me which policies are frozen and can't be changed?",
        "I need a policy id before I can attach it to a user.",
        "What custom policies exist besides the built-in ones?",
        "List all the access policies in the workspace.",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "identity_policy_list_permissions": {
    search: {
      keywords: "policy permissions permission rows grants resource constraints role access privileges what can role do inspect list read",
      queries: [
        "What access does this policy grant?",
        "Show the permission rows and resource constraints for this policy.",
        "What can this role do after its policies are attached?",
        "Read the grants on this policy before changing user access.",
        "What actions is this role allowed to perform?",
        "Show the permissions granted by the role's policy.",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "identity_policy_update": {
    search: {
      keywords: "permission access rule edit change update rename re-describe",
      queries: [
        "Can you rename this policy?",
        "How do I update the description on a custom policy?",
        "Can I edit a built-in or frozen policy?",
        "I want to change the name and description of a policy.",
        "How do I edit the label on a policy I created?",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  // --- identity / access -------------------------------------------------------------------
  "identity_role_assign": {
    search: {
      keywords: "admin administrator access permission permissions grant give role promote make elevate someone user remove role unassign role take away role revoke",
      queries: [
        "Can you give this user the Editor role?",
        "How do I grant admin access to a new team member?",
        "I want to assign a role to a user — can I give them more power than I have myself?",
        "How do I actually grant permissions to someone by role?",
        "Can you assign the moderator role to this account?",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "identity_role_create": {
    search: {
      keywords: "role roles permission group admin editor create new access level",
      queries: [
        "How do I make a custom role for our team?",
        "Can you create a new role called 'Editor'? Will it have any permissions right away?",
        "I want a new permission group that starts empty.",
        "How do I set up a brand-new custom role?",
        "Can you add a new role I can assign later?",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "identity_role_delete": {
    title: 'Permanently delete this role',
    summary: 'This permanently removes the selected role and its policy links.',
    search: {
      keywords: "role access level delete remove",
      queries: [
        "Can you delete a custom role we don't use anymore?",
        "How do I remove a role, and what happens if someone still has it?",
        "Can I delete one of the built-in roles?",
        "I want to get rid of an unused permission role.",
        "Why can't I delete this role — is it still assigned to someone?",
      ],
    },
    approval: { class: 'delete', confirmation: 'plan' },
  },
  "identity_role_list": {
    search: {
      keywords: "role roles permission groups access levels who can",
      queries: [
        "What roles exist in our workspace?",
        "Can you show me the built-in roles plus any custom ones we made?",
        "I need the role id before I can assign it to someone.",
        "What are all the permission roles available?",
        "List the roles so I know what I can assign to a new hire.",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "identity_role_rename": {
    search: {
      keywords: "role access level rename edit change name",
      queries: [
        "Can you rename this custom role?",
        "How do I change the label on one of our roles?",
        "Can I rename the built-in 'Viewer' role to something else?",
        "I want to give a custom role a clearer name.",
        "How do I relabel a role we created?",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "identity_user_create": {
    search: {
      keywords: "add user account new person invite staff admin create",
      queries: [
        "How do I add a new admin user?",
        "Can you create a login for a new team member?",
        "I want to set up a new operator account — will they have any permissions right away?",
        "How do I make a new user account with a username and password?",
        "Can you create a brand new principal for someone joining the team?",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct', input: 'human-form' },
    mcpUi: { secretField: { secret: true } },
  },
  "identity_user_disable": {
    search: {
      keywords: "lock out block ban suspend deactivate revoke disable access someone user account",
      queries: [
        "How do I revoke someone's admin access?",
        "Can you lock out a former employee from the admin panel?",
        "I want to disable a user but not delete their account.",
        "Can you remove the owner's access? What if there's no other owner?",
        "How do I deactivate an admin account that's already inactive?",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "identity_user_enable": {
    search: {
      keywords: "unlock unblock reactivate restore enable access user account",
      queries: [
        "Can you turn a disabled admin account back on?",
        "How do I restore access for someone I locked out earlier?",
        "I need to re-enable a user I disabled by mistake.",
        "Can you reactivate this operator's login?",
        "How do I give a disabled user their access back?",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "identity_user_list": {
    search: {
      keywords: "users accounts people staff admins who has access list",
      queries: [
        "Who are the admin users on this site?",
        "Can you show me everyone with access to the admin panel?",
        "I need a user's id before I can change their role.",
        "What roles does each operator currently have?",
        "Show me which admin accounts are active versus disabled.",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "identity_user_update_email": {
    search: {
      keywords: "email address change update user account password reset forgot password change password",
      queries: [
        "Can you update this admin's email address?",
        "How do I remove the email on file for a user?",
        "I need to change the contact email for one of our operators.",
        "Can you set a new email for this account? Can I also change their password here?",
        "How do I clear out a stored email address for a user?",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
} as const satisfies ToolMetadataById<ToolApprovalPolicy>;
