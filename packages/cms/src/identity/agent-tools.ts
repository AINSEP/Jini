/**
 * @file The identity (users/roles) agent-tool catalog — this domain's instance of the
 * per-domain `agent-tools.ts` convention already used by `features/content-types`,
 * `features/database`, and `features/recovery`.
 *
 * Purpose:
 * A static, in-process catalog describing every agent-callable identity tool and the permission
 * each one carries. `assistant/tool-registrations.ts` maps these entries onto handlers that call
 * `grant-service.ts` / `admin-crud-service.ts` — the SAME functions the human admin routes under
 * `server/routes/admin/users/` call. There is deliberately no path from a tool to the database
 * that skips those functions, because they are where the domain's authorization gates live.
 *
 * WHAT THIS CATALOG DELIBERATELY OMITS, and why (identity is the escalation-dense
 * surface, so the omissions are part of the design rather than a backlog):
 *
 *   - `resetUserPassword` (REQ-17). The one identity transition that sets a credential on
 *     an account the caller does not own, and — unlike `ASSIGN_ROLE`/`ATTACH_POLICY` — it carries
 *     NO INV-07 grant-authority clamp. A `user.manage` holder may reset the OWNER's password and
 *     then authenticate as owner, so it is a full account-takeover primitive rather than a
 *     permission grant. An assistant is reachable by prompt injection through ordinary operator
 *     content (a form submission, a comment) in a way a human clicking the admin button is not.
 *     Left human-UI-only, mirroring `features/content-types/agent-tools.ts`'s reasoning for never
 *     exposing the destructive-cleanup confirm() step to an agent.
 *   - `writePolicyPermission` (INV-07). This is the one policy transition still
 *     deliberately excluded, and on different grounds than the five wired below: unlike
 *     `identity_role_assign`/`identity_policy_attach`, which each confer whatever a role/policy
 *     ALREADY carries onto exactly one named target principal, `writePolicyPermission` MUTATES a
 *     shared, reusable `PolicyRecord` in place — and any non-built-in, non-frozen policy can
 *     already be attached to an arbitrary number of OTHER users via `identity_policy_attach` (or to
 *     roles via the seed-only `role_policies` table) before this call happens. The INV-07 clamp
 *     (`assertGrantClamp`) still bounds WHAT the caller can add — only a permission it itself holds
 *     unconstrained — but it says nothing about WHO ends up holding it: every principal already
 *     attached to that policy inherits the new permission the instant it is written, invisibly to
 *     whoever asked for the one change. That is a materially different blast-radius shape than the
 *     single-target primitives this catalog does wire (see the tool descriptions below), and exactly
 *     the "grant that ripples to principals never named in the call" class this pass's directive
 *     asks to be excluded and explained rather than wired reflexively. Left human-UI-only, where
 *     `apps/admin/src/sections/Roles.tsx`'s "Add permission" control still lives.
 *
 * Every OTHER policy transition (`identity_policy_list`, `identity_policy_create`,
 * `identity_policy_update`, `identity_policy_delete`, `identity_policy_attach`) IS wired below,
 * mirroring the risk profile this catalog already accepted for the equivalent role transitions
 * (`identity_role_list`/`identity_role_create`/`identity_role_rename`/`identity_role_delete`/
 * `identity_role_assign`) — see each entry's own description for why its shape matches its role
 * counterpart exactly.
 *
 *   - Role REVOCATION. Not a choice: no such operation exists anywhere in this codebase.
 *     `PrincipalRoleRepoPort` (`ports.ts`) declares `listByPrincipalId`, `save`, and `listByRoleId`
 *     — there is no `delete`, and no service function unassigns a role. A tool cannot be written
 *     against an operation the domain does not have, and adding a repo-level delete here to
 *     manufacture one would be exactly the "skip the service layer" failure this work exists to
 *     close. The same is true of "detach a policy from a principal" — `PrincipalPolicyRepoPort`
 *     has no delete either, so `identity_policy_attach` is one-directional exactly like
 *     `identity_role_assign`.
 *
 * Architectural role:
 * `identity` library declaration only. Performs no I/O and no enforcement — `authorize()` and each
 * service function's own caller-permission gate enforce at call time. The local
 * `AgentToolSideEffect`/`AgentToolActorClassRule`/`AgentToolDefinition` declarations mirror the
 * house convention: `features/database/agent-tools.ts` and `features/recovery/agent-tools.ts` each
 * declare their own structurally identical copy rather than importing another module's, so a
 * low-level library like `identity` never acquires a dependency on a feature module.
 */

export type AgentToolSideEffect = "none" | "mutates-durable-state" | "mints-token";

export type AgentToolActorClassRule = "confirmer-must-equal-own-delegatedBy" | "user-only" | "none";

export interface AgentToolDefinition {
  name: string;
  description: string;
  sideEffects: AgentToolSideEffect;
  /**
   * The permission the tool's underlying service function gates on.
   *
   * `orPermission` is present only where that gate is genuinely an OR — three identity transitions
   * accept `user.manage` OR `member.manage` (the admin-onboarding gate, `grant-service.ts`'s
   * `assertCallerHasAnyPermission`). Recording only the first would make this catalog quietly
   * disagree with the code it describes; `__tests__/agent-tools.authorization.test.ts` derives its
   * expected permission set from BOTH fields, so an undeclared OR fails the suite.
   */
  authorization: { permission: string; orPermission?: string };
  actorClassRule?: AgentToolActorClassRule;
  /**
   * JSON Schema for this tool's `input`, published to the model via `ToolDescriptor.inputSchema`
   * AND interpreted as the enforcing boundary parser by `agent-tool-input.ts`.
   *
   * Required, not optional as in `features/content-types/agent-tools.ts`: every entry here is
   * wired, so there is no unwired entry whose input shape is undesigned.
   */
  inputSchema: Readonly<Record<string, unknown>>;
}

/** A workspace-scoped principal id, as returned by `identity_user_list` or `identity_user_create`. */
const PRINCIPAL_ID_SCHEMA = {
  type: "string",
  minLength: 1,
  description: "The user's principalId. Get it from identity_user_list, or from identity_user_create's result.",
} as const;

/** A workspace-scoped role id, as returned by `identity_role_list` or `identity_role_create`. */
const ROLE_ID_SCHEMA = {
  type: "string",
  minLength: 1,
  description: "The role's id. Get it from identity_role_list, or from identity_role_create's result.",
} as const;

/** A workspace-scoped policy id, as returned by `identity_policy_list` or `identity_policy_create`. */
const POLICY_ID_SCHEMA = {
  type: "string",
  minLength: 1,
  description: "The policy's id. Get it from identity_policy_list, or from identity_policy_create's result.",
} as const;

/** A required, non-blank human-authored name. `minLength` is published because the service
 * functions reject a blank/whitespace-only name — leaving it unstated would show the model a
 * contract wider than the one enforced. */
const REQUIRED_NAME_SCHEMA = {
  type: "string",
  minLength: 1,
  description: "Human-readable name. Must not be blank or whitespace-only.",
} as const;

/** The input shape of the three read tools — they take no arguments at all. */
const NO_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [],
  properties: {},
} as const;

/** `{principalId}` — shared by the two principal-status transitions, which take exactly that. */
const PRINCIPAL_ONLY_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["principalId"],
  properties: { principalId: PRINCIPAL_ID_SCHEMA },
} as const;

/**
 * The identity domain's fixed agent-tool catalog.
 *
 * Ordered read-tools-first because that is the order a correct multi-step call chain uses: a model
 * cannot assign a role without a `roleId`, and the only way to learn one for an EXISTING role
 * (including the four seeded built-ins) is `identity_role_list`.
 */
export const identityAgentToolCatalog: AgentToolDefinition[] = [
  {
    name: "identity_user_list",
    description:
      "Lists the workspace's human operator users with their principalId, username, status, and assigned role ids. Read-only. Call this to find a user's principalId before updating, disabling, enabling, or assigning a role to them.",
    sideEffects: "none",
    authorization: { permission: "user.manage", orPermission: "member.manage" },
    inputSchema: NO_INPUT_SCHEMA,
  },
  {
    name: "identity_role_list",
    description:
      "Lists the workspace's roles (the four built-ins plus any custom ones) with their id, name, and isBuiltin flag. Read-only. Call this to find a roleId before assigning, renaming, or deleting a role.",
    sideEffects: "none",
    authorization: { permission: "role.manage" },
    inputSchema: NO_INPUT_SCHEMA,
  },
  {
    name: "identity_policy_list",
    description:
      "Lists the workspace's policies (built-ins plus any custom ones) with their id, name, description, isBuiltin, and isFrozen flags. Read-only. Call this to find a policyId before renaming, deleting, or attaching a policy.",
    sideEffects: "none",
    authorization: { permission: "role.manage" },
    inputSchema: NO_INPUT_SCHEMA,
  },
  {
    name: "identity_user_create",
    description:
      "Creates a new human operator user, minting a new principal and its credential row together. The new user starts with NO roles and therefore no permissions — grant access afterwards with identity_role_assign. Fails if the username is already taken.",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "user.manage", orPermission: "member.manage" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["username", "password"],
      properties: {
        username: {
          type: "string",
          minLength: 1,
          description: "Login name. Stored lowercased and Unicode-NFC-normalized, and unique per workspace on that normalized form.",
        },
        password: {
          type: "string",
          minLength: 1,
          description: "Initial password. Hashed with argon2id before storage; never stored or returned in plaintext.",
        },
        email: { type: "string", description: "Optional contact email." },
      },
    },
  },
  {
    name: "identity_user_update_email",
    description:
      "Sets or clears an existing user's email address. Omitting 'email' (or passing an empty string) CLEARS the stored value rather than leaving it unchanged. Username and password are not editable through this tool.",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "user.manage", orPermission: "member.manage" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["principalId"],
      properties: {
        principalId: PRINCIPAL_ID_SCHEMA,
        email: { type: "string", description: "The new email. Omit it or pass an empty string to clear the stored value." },
      },
    },
  },
  {
    name: "identity_user_disable",
    description:
      "Disables a user, revoking their access. Principals are never hard-deleted because the audit trail references them, so this is how a user is removed. Refuses to disable the seeded owner, and refuses any disable that would leave the workspace with no active owner. Already-disabled is a no-op.",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "user.manage" },
    inputSchema: PRINCIPAL_ONLY_INPUT_SCHEMA,
  },
  {
    name: "identity_user_enable",
    description:
      "Re-enables a previously disabled human user. Already-active is a no-op. Only kind='user' principals can be enabled this way.",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "user.manage" },
    inputSchema: PRINCIPAL_ONLY_INPUT_SCHEMA,
  },
  {
    name: "identity_role_create",
    description:
      "Creates a new custom role. The role starts with no policies attached and therefore confers no permissions until one is attached, which is not an agent-callable operation.",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "role.manage" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["name"],
      properties: { name: REQUIRED_NAME_SCHEMA },
    },
  },
  {
    name: "identity_role_assign",
    description:
      "Assigns an existing role to an existing user. This is the step that actually grants permissions. The caller can only confer permissions it already holds itself unconstrained, so assigning a role more powerful than the caller's own is refused.",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "role.manage" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["principalId", "roleId"],
      properties: { principalId: PRINCIPAL_ID_SCHEMA, roleId: ROLE_ID_SCHEMA },
    },
  },
  {
    name: "identity_role_rename",
    description:
      "Renames a custom role. Built-in roles cannot be renamed — relabelling 'viewer' to read as trusted is a social-engineering variant of privilege escalation, so it is refused.",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "role.manage" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["roleId", "name"],
      properties: { roleId: ROLE_ID_SCHEMA, name: REQUIRED_NAME_SCHEMA },
    },
  },
  {
    name: "identity_role_delete",
    description:
      "Deletes a custom role. Built-in roles cannot be deleted. A role still assigned to at least one user is refused — this system has no unassign operation, so a role in use cannot be removed at all.",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "role.manage" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["roleId"],
      properties: { roleId: ROLE_ID_SCHEMA },
    },
  },
  {
    name: "identity_policy_create",
    description:
      "Creates a new custom policy. The policy starts with no permissions and therefore confers none until permissions are added, which is not an agent-callable operation — identity_policy_write_permission is deliberately not wired (see this file's own header comment). Attaching a freshly created, still-empty policy to anyone is a no-op.",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "role.manage" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["name"],
      properties: {
        name: REQUIRED_NAME_SCHEMA,
        description: { type: "string", description: "Optional human-readable description." },
      },
    },
  },
  {
    name: "identity_policy_update",
    description:
      "Renames and/or re-describes a custom policy. Built-in and frozen policies are refused. At least one of 'name'/'description' must be supplied.",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "role.manage" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["policyId"],
      properties: {
        policyId: POLICY_ID_SCHEMA,
        name: { type: "string", minLength: 1, description: "New name. Omit to leave unchanged." },
        description: { type: "string", description: "New description. Omit to leave unchanged." },
      },
    },
  },
  {
    name: "identity_policy_delete",
    description:
      "Deletes a custom policy. Built-in and frozen policies cannot be deleted. A policy still referenced by at least one role or attached to at least one user is refused — deletion fails safe (it only ever removes access, never orphans a reference) exactly like identity_role_delete.",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "role.manage" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["policyId"],
      properties: { policyId: POLICY_ID_SCHEMA },
    },
  },
  {
    name: "identity_policy_attach",
    description:
      "Attaches an existing policy directly to an existing user, granting every permission the policy carries. This is the direct-grant counterpart to identity_role_assign, targets exactly one named user per call, and carries the identical INV-07 clamp: the caller can only confer permissions it already holds itself unconstrained, so attaching a policy more powerful than the caller's own is refused. There is no detach operation.",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "role.manage" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["principalId", "policyId"],
      properties: { principalId: PRINCIPAL_ID_SCHEMA, policyId: POLICY_ID_SCHEMA },
    },
  },
];
