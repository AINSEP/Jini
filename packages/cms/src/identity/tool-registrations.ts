/**
 * @file Identity's half of the agent-tool authorization wiring: maps `agent-tools.ts`'s fifteen catalog
 * entries onto the users/roles/policies transitions `grant-service.ts`/`admin-crud-service.ts`
 * export, plus the three repo-backed reads, as `ToolRegistration`s.
 *
 * `ToolPolicy.authorize` is a pass-through for all fifteen (see `buildDomainRegistrations`) for the
 * "one evaluator" reason: the gate is the domain layer's, reached identically by every
 * tool kind — mutations through their own service function, which opens with the check, and reads
 * through {@link assertIdentityReadAllowed}, which calls the domain's own exported
 * `assertCallerHasAnyPermission` rather than re-deriving an OR gate. A second check here would be a
 * duplicate evaluator, and one any non-tool caller of the same service function would bypass. See
 * `assistant/__tests__/tool-registrations.identity-authorization.test.ts`.
 */
import {
  buildDomainRegistrations,
  indexCatalogById,
  type AgentToolSideEffect,
  type DerivedRiskByToolId,
  type ToolHandler,
  type ToolRegistration,
} from "../core/tools/registration-kit.js";
import { parseIdentityToolInput } from "./agent-tool-input.js";
import { identityAgentToolCatalog, type AgentToolDefinition as IdentityAgentToolDefinition } from "./agent-tools.js";
import type { AuthServiceDeps } from "./auth-service.js";
import { assertCallerHasAnyPermission, assignRole, attachPolicy, createPolicy, createRole, createUser } from "./grant-service.js";
import { deletePolicy, deleteRole, disablePrincipal, enablePrincipal, updatePolicy, updateRole, updateUser } from "./admin-crud-service.js";
import type {
  IdentityRepos,
  PasswordHasherPort,
  PolicyPermissionRepoPort,
  PolicyRepoPort,
  PrincipalPolicyRepoPort,
  PrincipalRepoPort,
  PrincipalRoleRepoPort,
  RolePolicyRepoPort,
  RoleRepoPort,
  SessionRepoPort,
  UserRepoPort,
} from "./ports.js";
import type { PolicyRecord, PrincipalRecord, PrincipalRoleRecord, RoleRecord, UserRecord } from "./types.js";

const CATALOG_BY_ID = indexCatalogById(identityAgentToolCatalog);

/**
 * The exact slice of the route-deps bag Identity's tool handlers read. Declared structurally
 * (rather than importing `server/routes/types`'s `RouteDeps`) so this module carries no back-edge
 * into the composition root. `server/routes/*` satisfies this structurally by passing its existing
 * `RouteDeps` (in practice `UsersRouteDeps`, a `Pick<RouteDeps, ...>` subset — a strict superset of
 * this shape) object; nothing there changes.
 */
export interface IdentityToolDeps {
  workspaceId: string;
  clock: { nowIso(): string };
  idGen: { newId(): string };
  principalRepo: PrincipalRepoPort;
  userRepo: UserRepoPort;
  sessionRepo: SessionRepoPort;
  roleRepo: RoleRepoPort;
  policyRepo: PolicyRepoPort;
  policyPermissionRepo: PolicyPermissionRepoPort;
  rolePolicyRepo: RolePolicyRepoPort;
  principalRoleRepo: PrincipalRoleRepoPort;
  principalPolicyRepo: PrincipalPolicyRepoPort;
  passwordHasher: PasswordHasherPort;
  ownerPrincipalId: Promise<string>;
}

/**
 * Assembles `auth-service.ts`'s `IdentityRepos` bag from {@link IdentityToolDeps}'s flat fields — a
 * local duplicate of `server/routes/admin/users/deps.ts`'s `identityReposFrom` rather than an import
 * of it, for the same reason `features/settings/tool-registrations.ts`'s header gives for
 * duplicating `toWriteServiceDeps`: importing from the HTTP admin layer would invert this codebase's
 * ports/adapters direction. It is a field mapping, not logic, so the two copies carry no behavioral
 * drift risk.
 */
function identityReposFrom(deps: IdentityToolDeps): IdentityRepos {
  return {
    principals: deps.principalRepo,
    users: deps.userRepo,
    sessions: deps.sessionRepo,
    roles: deps.roleRepo,
    policies: deps.policyRepo,
    policyPermissions: deps.policyPermissionRepo,
    rolePolicies: deps.rolePolicyRepo,
    principalRoles: deps.principalRoleRepo,
    principalPolicies: deps.principalPolicyRepo,
  };
}

/** Assembles `grant-service.ts`'s/`admin-crud-service.ts`'s `AuthServiceDeps` bag from
 * {@link IdentityToolDeps} — the local twin of `identityReposFrom` just above. */
function identityServiceDepsFrom(deps: IdentityToolDeps): AuthServiceDeps {
  return {
    repos: identityReposFrom(deps),
    hasher: deps.passwordHasher,
    clock: deps.clock,
    idGen: deps.idGen,
  };
}

/**
 * This wiring layer's OWN risk classification, authored from what each handler below actually
 * calls. See `DerivedRiskByToolId` in the kit for why it is independent of the catalog's own
 * `sideEffects` declaration.
 */
export const identityDerivedRisk: DerivedRiskByToolId = new Map<string, AgentToolSideEffect>([
  // -> authorize() + repo reads only; no save on any path.
  ["identity_user_list", "none"],
  ["identity_role_list", "none"],
  ["identity_policy_list", "none"],
  // -> createUser (grant-service.ts): saves a principal row AND a users row (credential).
  ["identity_user_create", "mutates-durable-state"],
  // -> updateUser (admin-crud-service.ts): users.save, email field only.
  ["identity_user_update_email", "mutates-durable-state"],
  // -> disablePrincipal (admin-crud-service.ts): status flip, guarded by the INV-08 owner floor.
  ["identity_user_disable", "mutates-durable-state"],
  // -> enablePrincipal (admin-crud-service.ts): status flip back to active.
  ["identity_user_enable", "mutates-durable-state"],
  // -> createRole (grant-service.ts): roles.save, always isBuiltin=false.
  ["identity_role_create", "mutates-durable-state"],
  // -> assignRole (grant-service.ts): principalRoles.save behind the INV-07 grant clamp. The one
  //    identity tool that confers permissions, hence the heaviest of these.
  ["identity_role_assign", "mutates-durable-state"],
  // -> updateRole (admin-crud-service.ts): roles.save, refuses built-ins.
  ["identity_role_rename", "mutates-durable-state"],
  // -> deleteRole (admin-crud-service.ts): roles.delete, refuses built-ins and referenced roles.
  ["identity_role_delete", "mutates-durable-state"],
  // -> createPolicy (grant-service.ts): policies.save, always isBuiltin=false/isFrozen=false.
  ["identity_policy_create", "mutates-durable-state"],
  // -> updatePolicy (admin-crud-service.ts): policies.save, refuses built-in/frozen.
  ["identity_policy_update", "mutates-durable-state"],
  // -> deletePolicy (admin-crud-service.ts): policyPermissions.deleteByPolicyId + policies.delete,
  //    refuses built-in/frozen and still-referenced policies.
  ["identity_policy_delete", "mutates-durable-state"],
  // -> attachPolicy (grant-service.ts): principalPolicies.save behind the INV-07 grant clamp — the
  //    direct-grant counterpart to identity_role_assign, same weight.
  ["identity_policy_attach", "mutates-durable-state"],
]);

/**
 * Upper bound on the roster `identity_user_list` will fan out over.
 *
 * `routes/admin/users/list.ts` does the same O(n) per-user fan-out uncapped, on the documented
 * "operator-managed roster, not member/content scale" assumption. That assumption is fine for a
 * human screen and NOT fine here for a different reason than scale: this result is spent as model
 * context, so an unexpectedly large roster would silently consume the run's context window. The
 * cap truncates and SAYS SO in the payload rather than failing, so a caller that hits it can still
 * work with what it got and knows not to treat the list as complete.
 */
const IDENTITY_USER_LIST_MAX = 200;

function requireIdentityCatalogEntry(toolId: string): IdentityAgentToolDefinition {
  const entry = CATALOG_BY_ID.get(toolId);
  if (!entry) throw new Error(`identity/tool-registrations.ts: catalog has no entry named '${toolId}' — identity/agent-tools.ts drifted`);
  return entry;
}

/**
 * Validates `input` through the tool's OWN published `inputSchema` (interpreted by
 * `agent-tool-input.ts`), then re-throws any rejection with that schema appended.
 *
 * Identity is the one domain whose published schema is ALSO the enforcing parser, so this does not
 * use the kit's `withSchemaOnRejection`: there is no domain call to wrap, the rejection is produced
 * here. Same error-recovery contract either way — a model that gets back only "'roleId' is
 * required" must guess the rest of the shape, whereas one that gets the schema with it can correct
 * the call in a single turn.
 *
 * @complexity O(p) in the tool's declared property count.
 * @overallScore 100
 */
/**
 * A validated tool input, with required and optional reads spelled differently.
 *
 * The distinction is not decoration. `parseIdentityToolInput` returns a `Record<string, string>`
 * whose keys are whatever the caller supplied and the schema accepted, so nothing in the type says
 * which fields are guaranteed. Reading them all the same way makes a schema that forgot to mark a
 * field `required` indistinguishable from one that did — and the failure mode is silent: the
 * handler passes `undefined` into a service call, which stores it. Splitting the read means the
 * handler states which fields it is relying on, and a schema/handler disagreement throws at the
 * boundary naming the field.
 */
interface ValidatedIdentityInput {
  /** A field the tool's published `inputSchema` marks `required`. @throws {Error} If absent. */
  req(field: string): string;
  /** A field the schema leaves optional. `undefined` means the caller omitted it. */
  opt(field: string): string | undefined;
}

function identityInput(toolId: string, input: unknown): ValidatedIdentityInput {
  const entry = requireIdentityCatalogEntry(toolId);
  const parsed = parseIdentityToolInput({ schema: entry.inputSchema, input });
  if (!parsed.ok) {
    const recovery = "Fix the input and retry — this will not resolve on retry without an input change.";
    throw new Error(`${parsed.error.message}. ${recovery} Schema for '${toolId}': ${JSON.stringify(entry.inputSchema)}`);
  }
  const value = parsed.value;
  return {
    req(field) {
      const found = value[field];
      if (found === undefined) {
        throw new Error(
          `identity tool '${toolId}': the handler reads '${field}' as required, but the published inputSchema does not mark it required — add it to that schema's 'required' list, or read it with opt() and handle its absence`,
        );
      }
      return found;
    },
    opt(field) {
      return value[field];
    },
  };
}

/** The permission set a tool's catalog entry declares — both halves when the gate is an OR. */
function identityPermissionsFor(toolId: string): string[] {
  const { authorization } = requireIdentityCatalogEntry(toolId);
  return authorization.orPermission ? [authorization.permission, authorization.orPermission] : [authorization.permission];
}

/**
 * The gate for the two READ tools.
 *
 * The mutating tools need no equivalent: their domain function opens with this same
 * `assertCallerHasAnyPermission` call itself. Reads have no service-layer function to inherit it
 * from — `identity` exports grant-writing transitions, not read wrappers, which is why
 * `routes/admin/users/list.ts` also gates in the route and then reads the repo ports directly.
 * This calls the domain's own exported helper rather than re-deriving an OR gate (and rather than
 * the kit's generic `requireToolPermission`, which cannot express an OR), so the single
 * evaluator is reached by an identical path from both tool kinds.
 */
async function assertIdentityReadAllowed(routeDeps: IdentityToolDeps, toolId: string, callerPrincipalId: string): Promise<void> {
  await assertCallerHasAnyPermission({
    deps: identityServiceDepsFrom(routeDeps),
    workspaceId: routeDeps.workspaceId,
    callerPrincipalId,
    permissions: identityPermissionsFor(toolId),
  });
}

/** What an identity user tool returns to the model — see {@link toIdentityUserView}. */
interface IdentityUserToolView {
  principalId: string;
  username: string;
  status: PrincipalRecord["status"];
  roleIds: string[];
  email?: string;
}

/**
 * Projects a principal + its credential row into the explicit model-facing shape.
 *
 * The load-bearing omission is `UserRecord.passwordHash`: INV-05 keeps hashed secrets server-side,
 * and this view has no field for one, so there is nothing to forward by accident even if a future
 * `UserRecord` field is added. `workspaceId` is dropped for the same reason content-types'
 * `toContentTypeView` drops it — the agent is scoped to one workspace it cannot change, so echoing
 * the id spends model attention on a value that can never inform a decision.
 *
 * @param record.roleIds - The principal's role assignments, passed in rather than resolved here so
 * the projection stays pure and the caller decides whether the extra repo read is worth it.
 * @returns The model-facing view. `email` is present only when set, so a user without one carries
 * no always-undefined key.
 * @complexity O(r) in the role count (the array is copied so the caller cannot alias domain state).
 * @overallScore 100
 */
function toIdentityUserView(record: { principal: PrincipalRecord; user: UserRecord; roleIds: readonly string[] }): IdentityUserToolView {
  const view: IdentityUserToolView = {
    principalId: record.principal.id,
    username: record.user.username,
    status: record.principal.status,
    roleIds: [...record.roleIds],
  };
  if (record.user.email) view.email = record.user.email;
  return view;
}

/** What an identity role tool returns to the model. `isBuiltin` is kept because it is what predicts a rename/delete refusal. */
function toIdentityRoleView(role: RoleRecord): { id: string; name: string; isBuiltin: boolean } {
  return { id: role.id, name: role.name, isBuiltin: role.isBuiltin };
}

/**
 * What an identity policy tool returns to the model. `isBuiltin`/`isFrozen` are both kept because
 * together they are what predicts an update/delete/write-permission refusal (mirrors
 * `toIdentityRoleView`'s `isBuiltin`, extended for the second immutability flag policies carry that
 * roles do not). `description` is present only when set, matching `toIdentityUserView`'s `email`.
 */
function toIdentityPolicyView(policy: PolicyRecord): { id: string; name: string; isBuiltin: boolean; isFrozen: boolean; description?: string } {
  const view: { id: string; name: string; isBuiltin: boolean; isFrozen: boolean; description?: string } = {
    id: policy.id,
    name: policy.name,
    isBuiltin: policy.isBuiltin,
    isFrozen: policy.isFrozen,
  };
  if (policy.description) view.description = policy.description;
  return view;
}

/** Read a principal's role-assignment ids. Shared by every tool that returns a user view. */
async function roleIdsFor(routeDeps: IdentityToolDeps, principalId: string): Promise<string[]> {
  const links = await routeDeps.principalRoleRepo.listByPrincipalId({ workspaceId: routeDeps.workspaceId, principalId });
  return links.map((link) => link.roleId);
}

/**
 * Load the `UserRecord` paired with a principal the domain just returned.
 *
 * Every `kind='user'` principal has one by construction (CREATE_USER's atomicity guarantee), so
 * the miss is defensive rather than an expected path — the same reasoning `routes/admin/users/
 * disable.ts` records for its identical second lookup.
 */
async function requireUserRecord(routeDeps: IdentityToolDeps, principalId: string): Promise<UserRecord> {
  const user = await routeDeps.userRepo.findByPrincipalId({ workspaceId: routeDeps.workspaceId, principalId });
  if (!user) throw new Error(`user '${principalId}' was not found`);
  return user;
}

export function buildIdentityRegistrations(routeDeps: IdentityToolDeps): ToolRegistration[] {
  /** Assembled per call, not per handler, because every mutating handler needs the identical bag. */
  const serviceDeps = () => identityServiceDepsFrom(routeDeps);

  const handlers: Record<string, ToolHandler> = {
    identity_user_list: async (ctx) => {
      identityInput("identity_user_list", ctx.input);
      await assertIdentityReadAllowed(routeDeps, "identity_user_list", ctx.principal.id);

      const principals = await routeDeps.principalRepo.list({ workspaceId: routeDeps.workspaceId });
      // Humans only — `system`/`agent`/`api_key` principals (including the disabled `user-local`
      // seed row) are not what "users" means on this surface, matching `routes/.../list.ts`.
      const humans = principals.filter((principal) => principal.kind === "user");
      const page = humans.slice(0, IDENTITY_USER_LIST_MAX);

      const users = await Promise.all(
        page.map(async (principal) => {
          const user = await routeDeps.userRepo.findByPrincipalId({ workspaceId: routeDeps.workspaceId, principalId: principal.id });
          if (!user) return null;
          return toIdentityUserView({ principal, user, roleIds: await roleIdsFor(routeDeps, principal.id) });
        }),
      );

      const listed = users.filter((user): user is IdentityUserToolView => user !== null);
      return humans.length > page.length
        ? { users: listed, truncated: true, totalCount: humans.length }
        : { users: listed };
    },

    identity_role_list: async (ctx) => {
      identityInput("identity_role_list", ctx.input);
      await assertIdentityReadAllowed(routeDeps, "identity_role_list", ctx.principal.id);

      const roles = await routeDeps.roleRepo.list({ workspaceId: routeDeps.workspaceId });
      return { roles: roles.map(toIdentityRoleView) };
    },

    identity_policy_list: async (ctx) => {
      identityInput("identity_policy_list", ctx.input);
      await assertIdentityReadAllowed(routeDeps, "identity_policy_list", ctx.principal.id);

      const policies = await routeDeps.policyRepo.list({ workspaceId: routeDeps.workspaceId });
      return { policies: policies.map(toIdentityPolicyView) };
    },

    identity_user_create: async (ctx) => {
      const input = identityInput("identity_user_create", ctx.input);
      const { principal, user } = await createUser({
        deps: serviceDeps(),
        input: {
          workspaceId: routeDeps.workspaceId,
          callerPrincipalId: ctx.principal.id,
          username: input.req("username"),
          email: input.opt("email"),
          password: input.req("password"),
        },
      });
      // A brand-new principal has no assignments yet, so this is [] by construction, not a read.
      return { user: toIdentityUserView({ principal, user, roleIds: [] }) };
    },

    identity_user_update_email: async (ctx) => {
      const input = identityInput("identity_user_update_email", ctx.input);
      const { user } = await updateUser({
        deps: serviceDeps(),
        input: {
          workspaceId: routeDeps.workspaceId,
          callerPrincipalId: ctx.principal.id,
          principalId: input.req("principalId"),
          // Absent stays absent: `updateUser` treats a falsy email as "clear", which is exactly
          // what this tool's description tells the model omitting it does.
          email: input.opt("email"),
        },
      });
      const principal = await routeDeps.principalRepo.findById({ workspaceId: routeDeps.workspaceId, id: input.req("principalId") });
      if (!principal) throw new Error(`principal '${input.req("principalId")}' was not found`);
      return { user: toIdentityUserView({ principal, user, roleIds: await roleIdsFor(routeDeps, principal.id) }) };
    },

    identity_user_disable: async (ctx) => {
      const input = identityInput("identity_user_disable", ctx.input);
      const { principal } = await disablePrincipal({
        deps: serviceDeps(),
        input: {
          workspaceId: routeDeps.workspaceId,
          callerPrincipalId: ctx.principal.id,
          principalId: input.req("principalId"),
          // Resolved by the caller, per `disablePrincipal`'s own contract — the same
          // `await deps.ownerPrincipalId` the human disable route performs.
          seededOwnerPrincipalId: await routeDeps.ownerPrincipalId,
        },
      });
      const user = await requireUserRecord(routeDeps, principal.id);
      return { user: toIdentityUserView({ principal, user, roleIds: await roleIdsFor(routeDeps, principal.id) }) };
    },

    identity_user_enable: async (ctx) => {
      const input = identityInput("identity_user_enable", ctx.input);
      const { principal } = await enablePrincipal({
        deps: serviceDeps(),
        input: { workspaceId: routeDeps.workspaceId, callerPrincipalId: ctx.principal.id, principalId: input.req("principalId") },
      });
      const user = await requireUserRecord(routeDeps, principal.id);
      return { user: toIdentityUserView({ principal, user, roleIds: await roleIdsFor(routeDeps, principal.id) }) };
    },

    identity_role_create: async (ctx) => {
      const input = identityInput("identity_role_create", ctx.input);
      const { role } = await createRole({
        deps: serviceDeps(),
        input: { workspaceId: routeDeps.workspaceId, callerPrincipalId: ctx.principal.id, name: input.req("name") },
      });
      return { role: toIdentityRoleView(role) };
    },

    identity_role_assign: async (ctx) => {
      const input = identityInput("identity_role_assign", ctx.input);
      const { assignment }: { assignment: PrincipalRoleRecord } = await assignRole({
        deps: serviceDeps(),
        input: {
          workspaceId: routeDeps.workspaceId,
          callerPrincipalId: ctx.principal.id,
          principalId: input.req("principalId"),
          roleId: input.req("roleId"),
        },
      });
      // The join row's own id is not addressable by any other tool, so it is dropped; what the
      // model needs back is confirmation of WHICH pair is now linked.
      return { assigned: { principalId: assignment.principalId, roleId: assignment.roleId } };
    },

    identity_role_rename: async (ctx) => {
      const input = identityInput("identity_role_rename", ctx.input);
      const { role } = await updateRole({
        deps: serviceDeps(),
        input: { workspaceId: routeDeps.workspaceId, callerPrincipalId: ctx.principal.id, roleId: input.req("roleId"), name: input.req("name") },
      });
      return { role: toIdentityRoleView(role) };
    },

    identity_role_delete: async (ctx) => {
      const input = identityInput("identity_role_delete", ctx.input);
      await deleteRole({
        deps: serviceDeps(),
        input: { workspaceId: routeDeps.workspaceId, callerPrincipalId: ctx.principal.id, roleId: input.req("roleId") },
      });
      // `deleteRole` resolves void; an empty tool result would read to the model as "nothing
      // happened", so the deleted id is echoed as the acknowledgement.
      return { deleted: { roleId: input.req("roleId") } };
    },

    identity_policy_create: async (ctx) => {
      const input = identityInput("identity_policy_create", ctx.input);
      const { policy } = await createPolicy({
        deps: serviceDeps(),
        input: {
          workspaceId: routeDeps.workspaceId,
          callerPrincipalId: ctx.principal.id,
          name: input.req("name"),
          // Absent stays absent: `input.description` is only present when the caller supplied it
          // (`parseIdentityToolInput` omits absent optional keys entirely), so this passes through
          // unchanged rather than coercing a caller-supplied empty string to "no description".
          description: input.opt("description"),
        },
      });
      return { policy: toIdentityPolicyView(policy) };
    },

    identity_policy_update: async (ctx) => {
      const input = identityInput("identity_policy_update", ctx.input);
      const { policy } = await updatePolicy({
        deps: serviceDeps(),
        input: {
          workspaceId: routeDeps.workspaceId,
          callerPrincipalId: ctx.principal.id,
          policyId: input.req("policyId"),
          // Same absent-stays-absent reasoning as identity_policy_create — `updatePolicy` itself
          // distinguishes undefined ("leave unchanged") from an explicit empty string.
          name: input.opt("name"),
          description: input.opt("description"),
        },
      });
      return { policy: toIdentityPolicyView(policy) };
    },

    identity_policy_delete: async (ctx) => {
      const input = identityInput("identity_policy_delete", ctx.input);
      await deletePolicy({
        deps: serviceDeps(),
        input: { workspaceId: routeDeps.workspaceId, callerPrincipalId: ctx.principal.id, policyId: input.req("policyId") },
      });
      // `deletePolicy` resolves void; an empty tool result would read to the model as "nothing
      // happened", so the deleted id is echoed as the acknowledgement (mirrors identity_role_delete).
      return { deleted: { policyId: input.req("policyId") } };
    },

    identity_policy_attach: async (ctx) => {
      const input = identityInput("identity_policy_attach", ctx.input);
      const { attachment } = await attachPolicy({
        deps: serviceDeps(),
        input: {
          workspaceId: routeDeps.workspaceId,
          callerPrincipalId: ctx.principal.id,
          principalId: input.req("principalId"),
          policyId: input.req("policyId"),
        },
      });
      // The join row's own id is not addressable by any other tool, so it is dropped; what the
      // model needs back is confirmation of WHICH pair is now linked (mirrors identity_role_assign).
      return { attached: { principalId: attachment.principalId, policyId: attachment.policyId } };
    },
  };

  // No `unwiredToolIds`: identity wires its ENTIRE catalog (which is why its own
  // `AgentToolDefinition` makes `inputSchema` required rather than optional).
  return buildDomainRegistrations({
    domain: "identity",
    catalogModule: "identity/agent-tools.ts",
    catalog: CATALOG_BY_ID,
    handlers,
    derivedRisk: identityDerivedRisk,
  });
}
