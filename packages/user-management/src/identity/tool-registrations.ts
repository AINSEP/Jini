import { isDeepStrictEqual } from "node:util";
import type { ChatDeleteSurfaceDeps } from "@jini-ai/core/contracts/site/daemon-surface-exchanges";
import { toolMetadata } from '@jini-ai/core/tool-metadata/identity';
import { withToolMetadata } from '@jini-ai/core';
import { type assertUserAccountAction, SelfDeleteError } from "@jini-ai/user-management/identity/delete-user-service";
import { IdentityConflictError, OwnerRequiredError } from "@jini-ai/user-management";
/**
 * @file Identity tools built by Jini, with host human-confirmation and password-entry adapters.
 * The host owns SurfaceExchangeStore/tool-calls transport, so it wraps the domain handlers here.
 * identity_role_delete and identity_policy_delete permanently delete and require human approval,
 * consistent with the owner's trash/delete/restore-over-existing/publish policy. Granting a role
 * or attaching a policy is not a delete and does not need that gate.
 * identity_user_create takes the first password through the human dialog, browser -> route ->
 * parked handler, so it never enters model context or chat. The composition root installs tools;
 * importing this feature must not register them or create an assistant runtime cycle.
 */
import type { ToolContributor } from "@jini-ai/core";
import { buildIdentityRegistrations, identityDerivedRisk, type IdentityToolDeps as BaseIdentityToolDeps } from "../server/agent-tool-registrations.js";
import { type assertCallerHasAnyPermission, normalizeUsername, parseIdentityToolInput } from "../server/index.js";
import { ToolInputError, type ToolHandler, type ToolRegistration } from "@jini-ai/core";
import type { Clock } from "@jini-ai/core/primitives";
import type { SurfaceCardsPort, SurfaceCardSecretRun as SecretCardRun, SurfaceCardSecretOptions, SurfaceCardSecretDeps } from '@jini-ai/core/contracts/cards';
import type { HumanConfirmSpec } from '@jini-ai/core/contracts/site/human-confirm';
import type { ToolExecutionContext, ToolExecutionOptions, HumanConfirmer } from '@jini-ai/core';
import type { SecretCardForm } from "@jini-ai/core/contracts/cards";
import type { SurfaceOutcomeSpec } from "@jini-ai/core/contracts/cards";
import { createUsernameChangePort } from "@jini-ai/user-management/identity/username-change-ports";
import type { OutboxPort } from "@jini-ai/core/contracts/events";



/** The host keeps its ISO clock ABI at this adapter; shared service/rationale live in user-management/server. */
export type IdentityToolDeps = Omit<BaseIdentityToolDeps, "clock"> & {
  clock: Clock | { nowIso(): string };
  outbox: OutboxPort;
  isInTrash: (required: { principalId: string }, optional?: Record<string, never>) => Promise<boolean>;
  assertUserAccountAction: typeof assertUserAccountAction;
  assertCallerHasAnyPermission: typeof assertCallerHasAnyPermission;
  defineSecretCardTool: SurfaceCardsPort['defineSecretCardTool'];
  askThenReport: SurfaceCardSecretDeps['askThenReport'];
  secretCardOptions: SurfaceCardSecretOptions;
  secretField: { readonly secret?: boolean };
  formApp: SecretCardForm['app']; outcomeApp: SurfaceOutcomeSpec['app'];
  notConfirmedResult(input: { confirmed: false; reason: string }): Record<string, unknown>;
  approvalToolHandler: <TPrepared>(steps: {
    surfaces: ChatDeleteSurfaceDeps;
    prepare(input: { ctx: ToolExecutionContext }, optional: ToolExecutionOptions): Promise<TPrepared>;
    describe(input: { ctx: ToolExecutionContext; prepared: TPrepared }): HumanConfirmSpec | Promise<HumanConfirmSpec>;
    run(input: { ctx: ToolExecutionContext; prepared: TPrepared; confirmer: HumanConfirmer; choice?: string }, optional: ToolExecutionOptions): Promise<unknown>;
  }, optional: { flag: string; batch?: boolean }) => ToolHandler;
};

const ROLE_DELETE_TOOL_ID = "identity_role_delete";
const POLICY_DELETE_TOOL_ID = "identity_policy_delete";
const USER_CREATE_TOOL_ID = "identity_user_create";

/** Exported for the same reason {@link withoutPassword} is — see its doc comment. */
export const USER_CREATE_DESCRIPTION_SUFFIX =
  " The user types the new user's first password into a form this tool shows; never pass a password, and never ask for one in chat.";

/**
 * Validates `input` against the tool's published schema BEFORE any dialog is drawn, with the same
 * schema-bearing message Jini's own handlers give, so a malformed call never reaches the human.
 */
function validated({ toolId, schema, input }: { toolId: string; schema: unknown; input: unknown }, _options = {}): Readonly<Record<string, string>> {
  const parsed = parseIdentityToolInput({ schema: schema as Record<string, unknown>, input });
  if (!parsed.ok) {
    throw new ToolInputError({ message: `${parsed.error.message}. Fix the input and retry — this will not resolve on retry without an input change. ` +
        `Schema for '${toolId}': ${JSON.stringify(schema)}` });
  }
  return parsed.value;
}

/**
 * The model-facing schema for `identity_user_create`: Jini's, minus `password`. Exported so
 * `assistant/__tests__/tool-registrations.contracts.test.ts` can assert the wired registration's
 * published schema against a real derivation of the Jini catalog entry instead of either a second,
 * hand-copied expectation (which could silently drift from this function) or a blind id-based skip
 * (which would stop catching a real regression, e.g. `password` ceasing to be stripped).
 */
export function withoutPassword({ schema }: { schema: unknown }, _options = {}): unknown {
  const { properties, required, ...rest } = schema as { properties: Record<string, unknown>; required?: string[] };
  const { password: _password, ...kept } = properties;
  return { ...rest, required: (required ?? []).filter((key) => key !== "password"), properties: kept };
}

/** Human-readable dependency snapshots for the identity deletion confirmation. */
function identityReferenceDetails(
  { references }: { references: Record<string, readonly { id: string; permission?: string }[]> },
  _options: Record<string, never> = {},
): { label: string; value: string }[] {
  return Object.entries(references).map(([label, rows]) => {
    const names = rows.map(row => row.permission ? `${row.permission} (${row.id})` : row.id).join(", ") || "none";
    return { label, value: `${rows.length}: ${names}` };
  });
}

function userCreateForm(required: { username: string; emailSuffix: string; ports: Pick<IdentityToolDeps, "secretField" | "formApp"> }, _optional = {}): SecretCardForm {
  const { username, emailSuffix } = required;
  return {
    title: `Create the user ${username}?`,
    description: `A new login named ${username}${emailSuffix} will be created with no roles. Type their first password below.`,
    submitLabel: "Create user",
    fields: [{ kind: "string", name: "password", label: "Password", hint: "Typed here only, never shown to the assistant.", required: true,
      ...required.ports.secretField }],
    cancelLabel: "Cancel", app: required.ports.formApp,
    preferredFrameSize: ["100%", "360px"],
  };
}

function userCreateOutcome(required: { run: SecretCardRun<Record<string, unknown>>; username: string; app: SurfaceOutcomeSpec["app"] }, _optional = {}): SurfaceOutcomeSpec | undefined {
  const { run, username } = required;
  if (run.status !== "saved" && run.status !== "blank" && run.status !== "failed") return undefined;
  let message: string;
  if (run.status === "saved") message = `${username} can now sign in with the password you typed.`;
  else if (run.status === "blank") message = "No password was entered. Nothing was created.";
  else message = run.safeMessage;
  return {
    title: run.status === "saved" ? "User created" : "User not created",
    details: [{ label: "Username", value: username }], state: run.status === "saved" ? "success" : "failure",
    message,
    app: required.app, preferredFrameSize: ["100%", "240px"],
  };
}
  /** Each family supplies its own label and service permission; Jini owns the asking sequence.
   * The inner service reauthorizes at write time; the snapshot prevents callback input retargeting. */
  // SQL list ports promise a set, not row order. Canonicalize both snapshots so an
  // unchanged set cannot invalidate confirmation just because query order changed.
  // O(n log n) local sorting across n dependency rows; no additional repo reads.
  

function createIdentityDeleteReferences(routeDeps: IdentityToolDeps) {
  return async ({ kind, id }: { kind: "role" | "policy"; id: string }, _options = {}): Promise<Record<string, readonly { id: string; permission?: string }[]>> => {
    const references: Record<string, readonly { id: string; permission?: string }[]> = kind === "role"
      ? { principals: await routeDeps.principalRoleRepo.listByRoleId({ workspaceId: routeDeps.workspaceId, roleId: id }), policies: await routeDeps.rolePolicyRepo.listByRoleId({ workspaceId: routeDeps.workspaceId, roleId: id }) }
      : { principals: await routeDeps.principalPolicyRepo.listByPolicyId({ workspaceId: routeDeps.workspaceId, policyId: id }), roles: await routeDeps.rolePolicyRepo.listByPolicyId({ workspaceId: routeDeps.workspaceId, policyId: id }), permissions: await routeDeps.policyPermissionRepo.listByPolicyId({ workspaceId: routeDeps.workspaceId, policyId: id }) };
    return Object.fromEntries(Object.entries(references).map(([label, rows]) => [label, [...rows].sort((a, b) => {
      if (a.id < b.id) return -1;
      if (a.id > b.id) return 1;
      return 0;
    })]));
  };
}

function createConfirmedIdentityDelete({ routeDeps, surfaces, identity, deleteReferences }: { routeDeps: IdentityToolDeps; surfaces: ChatDeleteSurfaceDeps; identity: Parameters<typeof assertUserAccountAction>[0]['deps']; deleteReferences: ReturnType<typeof createIdentityDeleteReferences> }) {
  return ({ registration, kind }: { registration: ToolRegistration; kind: "role" | "policy" }, _options = {}): ToolRegistration => ({
    ...registration,
    handler: routeDeps.approvalToolHandler({ surfaces,
      prepare: async ({ ctx }) => {
        const input = validated({ toolId: registration.descriptor.id, schema: registration.descriptor.inputSchema, input: ctx.input });
        await routeDeps.assertCallerHasAnyPermission({ deps: identity, workspaceId: routeDeps.workspaceId,
          // Jini owns both role and policy deletion under role.manage.
          callerPrincipalId: ctx.principal.id, permissions: ["role.manage"] });
        const id = input[`${kind}Id`];
        if (id === undefined) throw new ToolInputError({ message: `${registration.descriptor.id}: ${kind} ID is missing. Nothing was deleted.` });
        const repo = kind === "role" ? routeDeps.roleRepo : routeDeps.policyRepo;
        const existing = await repo.findById({ workspaceId: routeDeps.workspaceId, id });
        if (!existing) throw new ToolInputError({ message: `${registration.descriptor.id}: ${kind} was not found. Nothing was deleted.` });
        const references = await deleteReferences({ kind, id });
        return { id, snapshot: structuredClone(existing), references: structuredClone(references), label: existing.name };
      },
      describe: ({ prepared: { id, label, references } }) => ({
        toolId: registration.descriptor.id, errorCode: "IDENTITY", title: `Delete the ${kind} ${label}?`,
        details: [{ label: "Count", value: "1" }, { label: kind === "role" ? "Role" : "Policy", value: `${label} (${id})` }, ...identityReferenceDetails({ references })],
        warning: `The ${kind} is deleted for good. This can't be undone. Existing assignments prevent deletion; remove them in the Roles admin screen first.`, danger: true, confirmLabel: `Delete ${kind}`,
      }),
      run: async ({ ctx, prepared: { id, snapshot, references } }, options) => {
        const repo = kind === "role" ? routeDeps.roleRepo : routeDeps.policyRepo;
        if (!isDeepStrictEqual(await repo.findById({ workspaceId: routeDeps.workspaceId, id }), snapshot)) {
          throw new ToolInputError({ message: `${registration.descriptor.id}: target changed while confirmation was open. Request a new confirmation; nothing was deleted.` });
        }
        const currentReferences = await deleteReferences({ kind, id });
        if (!isDeepStrictEqual(currentReferences, references)) throw new ToolInputError({ message: `${registration.descriptor.id}: dependencies changed while confirmation was open. Request a new confirmation; nothing was deleted.` });
        return registration.handler({ ...ctx, input: { [`${kind}Id`]: id } }, options);
      },
    }, { flag: "deleted", batch: true }),
  });
}

function createHumanPasswordUserHandler({ routeDeps, surfaces, identity }: { routeDeps: IdentityToolDeps; surfaces: ChatDeleteSurfaceDeps; identity: Parameters<typeof assertUserAccountAction>[0]['deps'] }) {
  return ({ inner, publishedSchema }: { inner: ToolHandler; publishedSchema: unknown }, _options = {}): ToolHandler => async (ctx, options = {}) => {
    if (typeof ctx.input === "object" && ctx.input !== null && "password" in ctx.input) {
      throw new ToolInputError({ message: `IDENTITY_PASSWORD_NOT_ACCEPTED: ${USER_CREATE_TOOL_ID}: do not pass a password. The user types the new ` +
          "user's first password into the form this tool shows. Nothing was created." });
    }
    const input = validated({ toolId: USER_CREATE_TOOL_ID, schema: publishedSchema, input: ctx.input });
    const username = input["username"];
    if (username === undefined) throw new ToolInputError({ message: `${USER_CREATE_TOOL_ID}: username is missing. Nothing was created.` });
    const emailSuffix = input["email"] ? ` (${input["email"]})` : "";
    let failureMessage: string | undefined;
    const card = routeDeps.defineSecretCardTool<Readonly<Record<string, string>>, Record<string, unknown>, Record<string, unknown> | undefined>({
      toolId: USER_CREATE_TOOL_ID,
      prepare: async () => {
        // Use the service's own permission rule before opening; createUser checks it again at save.
        await routeDeps.assertCallerHasAnyPermission({ deps: identity, workspaceId: routeDeps.workspaceId,
          callerPrincipalId: ctx.principal.id, permissions: ["user.manage"] });
        return input;
      },
      form: () => userCreateForm({ username, emailSuffix, ports: routeDeps }),
      save: async ({ values, prep, signal }) => (await inner({ ...ctx, signal, input: { ...prep, password: values.password } }, options)) as Record<string, unknown>,
      result: ({ run }) => {
        if (run.status === "saved") return { created: true, ...run.saved };
        if (run.status === "blank") return { created: false, cancelled: false, note: "The user submitted no password. Nothing was created." };
        if (run.status === "failed") { failureMessage = run.safeMessage; return undefined; }
        return { created: false, ...routeDeps.notConfirmedResult({ confirmed: false, reason: run.status === "cancelled" ? "declined" : run.status }) };
      },
      outcome: ({ run }) => userCreateOutcome({ run, username, app: routeDeps.outcomeApp }),
    }, {
      ...routeDeps.secretCardOptions,
      // Rebuild the known conflict from public input; hasher/repository exceptions can contain the password.
      safeError: error => error instanceof IdentityConflictError ? `username '${normalizeUsername({ raw: username })}' is already in use` : undefined,
    });
    const result = await card.handler({ surfaceExchanges: surfaces.surfaceExchanges, askThenReport: routeDeps.askThenReport })(ctx, options);
    // Preserve the domain's rejection contract after the engine has delivered the safe failure card.
    if (failureMessage !== undefined) throw new ToolInputError({ message: failureMessage });
    return result;
  };
}

/** Runs the owner account guard in the same transaction as the wrapped disable/enable tool, and
 *  turns its refusals into plain tool errors that say nothing was changed. */
function gateAccountActionTool({ registration, routeDeps, identity, action }: { registration: ToolRegistration; routeDeps: IdentityToolDeps;
  identity: Parameters<typeof assertUserAccountAction>[0]['deps']; action: "disable" | "enable" }, _optional = {}): ToolRegistration {
  const toolId = registration.descriptor.id;
  return { ...registration, handler: async (ctx, options = {}) => {
    const input = validated({ toolId, schema: registration.descriptor.inputSchema, input: ctx.input });
    const principalId = input["principalId"];
    if (principalId === undefined) throw new ToolInputError({ message: `${toolId}: principal ID is missing. Nothing was changed.` });
    try {
      return await routeDeps.transactions.run({ workspaceId: routeDeps.workspaceId, execute: async () => {
        await routeDeps.assertUserAccountAction({ deps: identity, workspaceId: routeDeps.workspaceId, principalId, action },
          { callerPrincipalId: ctx.principal.id, seededOwnerPrincipalId: await routeDeps.ownerPrincipalId });
        return registration.handler(ctx, options);
      } });
    } catch (error) {
      if (error instanceof SelfDeleteError || error instanceof OwnerRequiredError) {
        const code = error instanceof SelfDeleteError ? "SELF_DELETE" : "OWNER_REQUIRED";
        throw new ToolInputError({ message: `${toolId}: ${code}: ${error.message}. Nothing was changed.` });
      }
      throw error;
    }
  } };
}

function gateIdentityRegistration(registration: ToolRegistration, { routeDeps, identity, confirmedDelete, createUserWithHumanPassword }: { routeDeps: IdentityToolDeps; identity: Parameters<typeof assertUserAccountAction>[0]['deps']; confirmedDelete: ReturnType<typeof createConfirmedIdentityDelete>; createUserWithHumanPassword: ReturnType<typeof createHumanPasswordUserHandler> }): ToolRegistration {
    switch (registration.descriptor.id) {
      case "identity_user_disable":
        return gateAccountActionTool({ registration, routeDeps, identity, action: "disable" });
      // B151: the assistant's enable must obey the same owner-only rule as the HTTP route.
      case "identity_user_enable":
        return gateAccountActionTool({ registration, routeDeps, identity, action: "enable" });

      case ROLE_DELETE_TOOL_ID:
        return confirmedDelete({ registration, kind: "role" });
      case POLICY_DELETE_TOOL_ID:
        return confirmedDelete({ registration, kind: "policy" });
      case USER_CREATE_TOOL_ID: {
        const inputSchema = withoutPassword({ schema: registration.descriptor.inputSchema });
        return {
          ...registration,
          descriptor: {
            ...registration.descriptor,
            description: `${registration.descriptor.description ?? ""}${USER_CREATE_DESCRIPTION_SUFFIX}`,
            inputSchema,
          },
          handler: createUserWithHumanPassword({ inner: registration.handler, publishedSchema: inputSchema }),
        };
      }
      default:
        return registration;
    }
  }


/**
 * Jini's identity registrations with `identity_role_delete`/`identity_policy_delete`/
 * `identity_user_create` gated behind the human; every other tool passes through unchanged.
 *
 * @complexity O(n) in the registration count; each gate adds one or two repo reads per call.
 */
export function buildGatedIdentityRegistrations(
  routeDeps: IdentityToolDeps,
  surfaces: ChatDeleteSurfaceDeps,
): ToolRegistration[] {

  const hostClock = routeDeps.clock;
  const clock: Clock = "nowMs" in hostClock ? hostClock : { nowMs: () => Date.parse(hostClock.nowIso()) };
  const identity = {
    repos: { transactions: routeDeps.transactions, principals: routeDeps.principalRepo, users: routeDeps.userRepo,
      sessions: routeDeps.sessionRepo, roles: routeDeps.roleRepo, policies: routeDeps.policyRepo,
      policyPermissions: routeDeps.policyPermissionRepo, rolePolicies: routeDeps.rolePolicyRepo,
      principalRoles: routeDeps.principalRoleRepo, principalPolicies: routeDeps.principalPolicyRepo },
    hasher: routeDeps.passwordHasher, clock, idGen: routeDeps.idGen, tokens: routeDeps.tokens,
  };
  const usernameChanges = createUsernameChangePort({ outbox: routeDeps.outbox, isInTrash: routeDeps.isInTrash, idGen: routeDeps.idGen,
    seededOwnerPrincipalId: routeDeps.ownerPrincipalId });
  const deleteReferences = createIdentityDeleteReferences(routeDeps);
  const confirmedDelete = createConfirmedIdentityDelete({ routeDeps, surfaces, identity, deleteReferences });
  const createUserWithHumanPassword = createHumanPasswordUserHandler({ routeDeps, surfaces, identity });

  return withToolMetadata({ registrations: buildIdentityRegistrations({ ...routeDeps, clock, usernameChanges }), metadata: toolMetadata }).map(registration => gateIdentityRegistration(registration, { routeDeps, identity, confirmedDelete, createUserWithHumanPassword }));
}

/**
 * Contributes Identity's AI tools to the assistant's catalog — called once by
 * `apps/website/src/server/runtime/composition/tool-catalog-manifest.ts`'s `installFirstPartyToolContributors()`, not by importing this
 * module. `assistant/tool-registrations.ts` no longer imports `buildIdentityRegistrations`/
 * `identityDerivedRisk` by name; this is the seam that replaced it.
 */
export function contributeIdentityTools(): ToolContributor<IdentityToolDeps, ChatDeleteSurfaceDeps> {
  return { domain: "identity", build: buildGatedIdentityRegistrations, risk: identityDerivedRisk };
}
