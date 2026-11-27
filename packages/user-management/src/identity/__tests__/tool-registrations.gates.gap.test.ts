import { describe, expect, it } from "vitest";
import { assertVersionedWrite } from "@jini-ai/core/optimistic-concurrency";
import { ToolInputError, type ToolExecutionContext } from "@jini-ai/core";
import type { HumanConfirmSpec } from "@jini-ai/core/contracts/site/human-confirm";
import type { SurfaceCardSecretOptions, SurfaceCardSecretRun, SurfaceCardSecretSpec, SurfaceCardOutcome, SecretCardForm } from "@jini-ai/core/contracts/cards";
import { IdentityConflictError as PackageIdentityConflictError, OwnerRequiredError as PackageOwnerRequiredError } from "@jini-ai/user-management";
import { buildIdentityRegistrations, identityDerivedRisk } from "../../server/agent-tool-registrations.js";
import { InMemoryPrincipalRepo, InMemoryUserRepo, InMemorySessionRepo, InMemoryRoleRepo, InMemoryPolicyRepo,
  InMemoryPolicyPermissionRepo, InMemoryRolePolicyRepo, InMemoryPrincipalRoleRepo, InMemoryPrincipalPolicyRepo,
  createTransactionalInMemoryIdentityRepos, seedIdentity, assertCallerHasAnyPermission, normalizeUsername, parseIdentityToolInput } from "../../server/index.js";
import type { IdentityRepos } from "../../core/index.js";
import { SelfDeleteError, assertUserAccountAction } from "../delete-user-service.js";
import { createUsernameChangePort } from "../username-change-ports.js";
import { buildGatedIdentityRegistrations, contributeIdentityTools, USER_CREATE_DESCRIPTION_SUFFIX, type IdentityToolDeps } from "../tool-registrations.js";

type CardScript = { status: "submit"; password: string } | { status: "blank" | "cancelled" | "expired" };
interface FixtureOptions { duringApproval?: (repos: IdentityRepos) => Promise<void>; decline?: boolean; card?: CardScript; withApps?: boolean;
  accountAction?: IdentityToolDeps["assertUserAccountAction"] }

/** Real in-memory identity + the real Jini registrations; only the human surfaces are scripted fakes. */
async function fixture(options: FixtureOptions = {}) {
  const repos = createTransactionalInMemoryIdentityRepos({ repos: {
    principals: new InMemoryPrincipalRepo({}), users: new InMemoryUserRepo({ assertVersionedWrite }), sessions: new InMemorySessionRepo({}),
    roles: new InMemoryRoleRepo({ assertVersionedWrite }), policies: new InMemoryPolicyRepo({ assertVersionedWrite }),
    policyPermissions: new InMemoryPolicyPermissionRepo({}), rolePolicies: new InMemoryRolePolicyRepo({}),
    principalRoles: new InMemoryPrincipalRoleRepo({}), principalPolicies: new InMemoryPrincipalPolicyRepo({}),
  } });
  let nextId = 0;
  const idGen = { newId: () => `id-${++nextId}` };
  const hasher = { hash: async () => "hash-x", verify: async () => true };
  const { ownerPrincipalId } = await seedIdentity({ deps: { repos, clock: { nowMs: () => 0 }, idGen, hasher }, input: { workspaceId: "ws", ownerUsername: "owner", ownerPassword: "owner-pass" } });
  const confirmations: HumanConfirmSpec[] = []; const forms: SecretCardForm[] = []; const outcomes: (SurfaceCardOutcome | undefined)[] = [];
  const cardOptions: SurfaceCardSecretOptions[] = []; const cardSurfaces: unknown[] = [];
  const surfaceExchanges = { id: "exchange-store" };
  const script: CardScript = options.card ?? { status: "submit", password: "pw-typed" };
  const deps = {
    buildIdentityRegistrations, identityDerivedRisk, normalizeUsername, parseIdentityToolInput, createUsernameChangePort, SelfDeleteError,
    workspaceId: "ws", clock: { nowIso: () => "1970-01-01T00:00:00.000Z" }, idGen, passwordHasher: hasher, ownerPrincipalId: Promise.resolve(ownerPrincipalId),
    transactions: repos.transactions, principalRepo: repos.principals, userRepo: repos.users, sessionRepo: repos.sessions,
    roleRepo: repos.roles, policyRepo: repos.policies, policyPermissionRepo: repos.policyPermissions,
    rolePolicyRepo: repos.rolePolicies, principalRoleRepo: repos.principalRoles, principalPolicyRepo: repos.principalPolicies,
    assertCallerHasAnyPermission, assertUserAccountAction: options.accountAction ?? assertUserAccountAction, outbox: {}, isInTrash: async () => false,
    secretField: { secret: true }, secretCardOptions: { frameSize: ["1px", "1px"] as const },
    formApp: options.withApps ? { appName: "form-app", appVersion: "1", showSecret: "show", hideSecret: "hide" } : undefined,
    outcomeApp: options.withApps ? { appName: "outcome-app", appVersion: "1", showSecret: "show", hideSecret: "hide" } : undefined,
    askThenReport: async () => undefined,
    notConfirmedResult: ({ reason }: { confirmed: false; reason: string }) => ({ confirmed: false, reason }),
    approvalToolHandler: <T>(steps: { prepare(i: { ctx: ToolExecutionContext }, o: object): Promise<T>; describe(i: { ctx: ToolExecutionContext; prepared: T }): HumanConfirmSpec | Promise<HumanConfirmSpec>;
      run(i: { ctx: ToolExecutionContext; prepared: T; confirmer: { id: string; kind: "user" } }, o: object): Promise<unknown> }) => async (ctx: ToolExecutionContext) => {
      const prepared = await steps.prepare({ ctx }, {});
      confirmations.push(await steps.describe({ ctx, prepared }));
      if (options.decline) return { confirmed: false };
      await options.duringApproval?.(repos);
      return steps.run({ ctx, prepared, confirmer: { id: ownerPrincipalId, kind: "user" } }, {});
    },
    defineSecretCardTool: <Prep, Saved, Result>(spec: SurfaceCardSecretSpec<Prep, Saved, Result>, opts: SurfaceCardSecretOptions = {}) => {
      cardOptions.push(opts);
      return { toolId: spec.toolId, secretFieldNames: () => ["password"], handler: (cardDeps: { surfaceExchanges: unknown }) => async (ctx: ToolExecutionContext) => {
        cardSurfaces.push(cardDeps.surfaceExchanges);
        const prep = await spec.prepare({ ctx });
        forms.push(spec.form({ prep }));
        let run: SurfaceCardSecretRun<Saved>;
        if (script.status === "submit") {
          try { run = { status: "saved", saved: await spec.save({ values: { password: script.password }, prep, signal: ctx.signal }) }; }
          catch (error) { run = { status: "failed", safeMessage: opts.safeError?.(error) ?? "Saving failed." }; }
        } else run = { status: script.status };
        outcomes.push(spec.outcome({ prep, run }));
        return spec.result({ prep, run });
      } };
    },
  };
  // One cast at the fixture edge: the host-owned surface store and token ports are opaque to these gates.
  const tools = buildGatedIdentityRegistrations(deps as unknown as IdentityToolDeps, { surfaceExchanges } as unknown as Parameters<typeof buildGatedIdentityRegistrations>[1]);
  const tool = (id: string) => { const found = tools.find((t) => t.descriptor.id === id); if (!found) throw new Error(`missing ${id}`); return found; };
  return { repos, ownerPrincipalId, tool, confirmations, forms, outcomes, cardOptions, cardSurfaces, surfaceExchanges };
}
const ctx = (principalId: string, input: unknown): ToolExecutionContext => ({ executionId: "exec", principal: { id: principalId }, run: { id: "run" }, input, signal: new AbortController().signal });
const role = { id: "role-1", workspaceId: "ws", name: "Temp", isBuiltin: false, version: 1 };
const policy = { id: "pol-1", workspaceId: "ws", name: "Extra", isBuiltin: false, isFrozen: false, version: 1 };

describe("identity_role_delete / identity_policy_delete confirmation gate", () => {
  it("describes a role with its dependency rows sorted by id, and deletes nothing when declined", async () => {
    const f = await fixture({ decline: true });
    await f.repos.roles.save(role);
    await f.repos.rolePolicies.save({ id: "rp-b", workspaceId: "ws", roleId: "role-1", policyId: "x" });
    await f.repos.rolePolicies.save({ id: "rp-a", workspaceId: "ws", roleId: "role-1", policyId: "y" });
    await f.repos.rolePolicies.save({ id: "rp-c", workspaceId: "ws", roleId: "role-1", policyId: "z" });
    await f.tool("identity_role_delete").handler(ctx(f.ownerPrincipalId, { roleId: "role-1" }));
    expect(f.confirmations).toEqual([{ toolId: "identity_role_delete", errorCode: "IDENTITY", title: "Delete the role Temp?",
      details: [{ label: "Count", value: "1" }, { label: "Role", value: "Temp (role-1)" }, { label: "principals", value: "0: none" }, { label: "policies", value: "3: rp-a, rp-b, rp-c" }],
      warning: "The role is deleted for good. This can't be undone. Existing assignments prevent deletion; remove them in the Roles admin screen first.", danger: true, confirmLabel: "Delete role" }]);
    expect(await f.repos.roles.findById({ workspaceId: "ws", id: "role-1" })).toEqual(role);
  });

  it("describes a policy with principals, roles and named permission rows", async () => {
    const f = await fixture({ decline: true });
    await f.repos.policies.save(policy);
    await f.repos.principalPolicies.save({ id: "pp-1", workspaceId: "ws", principalId: "someone", policyId: "pol-1" });
    await f.repos.policyPermissions.save({ id: "g-1", workspaceId: "ws", policyId: "pol-1", permission: "page.edit", resourceType: null, constraintJson: null });
    await f.tool("identity_policy_delete").handler(ctx(f.ownerPrincipalId, { policyId: "pol-1" }));
    expect(f.confirmations[0]?.title).toBe("Delete the policy Extra?");
    expect(f.confirmations[0]?.confirmLabel).toBe("Delete policy");
    expect(f.confirmations[0]?.details).toEqual([{ label: "Count", value: "1" }, { label: "Policy", value: "Extra (pol-1)" },
      { label: "principals", value: "1: pp-1" }, { label: "roles", value: "0: none" }, { label: "permissions", value: "1: page.edit (g-1)" }]);
  });

  it("deletes an unreferenced role after approval and echoes the id", async () => {
    const f = await fixture();
    await f.repos.roles.save(role);
    expect(await f.tool("identity_role_delete").handler(ctx(f.ownerPrincipalId, { roleId: "role-1" }))).toEqual({ deleted: { roleId: "role-1" } });
    expect(await f.repos.roles.findById({ workspaceId: "ws", id: "role-1" })).toBeNull();
  });

  it("refuses malformed input with the schema before any dialog", async () => {
    const f = await fixture();
    await expect(f.tool("identity_role_delete").handler(ctx(f.ownerPrincipalId, {}))).rejects.toThrow(/Fix the input and retry .*Schema for 'identity_role_delete'/);
    expect(f.confirmations).toEqual([]);
  });

  it("refuses an unknown role before any dialog", async () => {
    const f = await fixture();
    await expect(f.tool("identity_role_delete").handler(ctx(f.ownerPrincipalId, { roleId: "ghost" }))).rejects.toThrow("identity_role_delete: role was not found. Nothing was deleted.");
    expect(f.confirmations).toEqual([]);
  });

  it("refuses when the role is renamed while the confirmation is open", async () => {
    const f = await fixture({ duringApproval: async (repos) => { await repos.roles.save({ ...role, name: "Renamed" }); } });
    await f.repos.roles.save(role);
    await expect(f.tool("identity_role_delete").handler(ctx(f.ownerPrincipalId, { roleId: "role-1" })))
      .rejects.toThrow("identity_role_delete: target changed while confirmation was open. Request a new confirmation; nothing was deleted.");
    expect((await f.repos.roles.findById({ workspaceId: "ws", id: "role-1" }))?.name).toBe("Renamed");
  });

  it("refuses when a dependency appears while the confirmation is open", async () => {
    const f = await fixture({ duringApproval: async (repos) => { await repos.rolePolicies.save({ id: "rp-new", workspaceId: "ws", roleId: "role-1", policyId: "pol-1" }); } });
    await f.repos.roles.save(role);
    await expect(f.tool("identity_role_delete").handler(ctx(f.ownerPrincipalId, { roleId: "role-1" })))
      .rejects.toThrow("identity_role_delete: dependencies changed while confirmation was open. Request a new confirmation; nothing was deleted.");
    expect(await f.repos.roles.findById({ workspaceId: "ws", id: "role-1" })).toEqual(role);
  });
});

describe("identity_user_create human password card", () => {
  it("publishes a password-free schema and description", async () => {
    const f = await fixture();
    const descriptor = f.tool("identity_user_create").descriptor;
    expect(descriptor.description?.endsWith(USER_CREATE_DESCRIPTION_SUFFIX)).toBe(true);
    expect(JSON.stringify(descriptor.inputSchema)).not.toContain("password");
  });

  it("refuses a password passed by the model before any card", async () => {
    const f = await fixture();
    await expect(f.tool("identity_user_create").handler(ctx(f.ownerPrincipalId, { username: "newbie", password: "x" })))
      .rejects.toThrow("IDENTITY_PASSWORD_NOT_ACCEPTED: identity_user_create: do not pass a password.");
    expect(f.forms).toEqual([]);
  });

  it("creates the user with the typed password and reports success", async () => {
    const f = await fixture({ withApps: true });
    const result = await f.tool("identity_user_create").handler(ctx(f.ownerPrincipalId, { username: "newbie", email: "newbie@example.test" }));
    expect(result).toMatchObject({ created: true, user: { username: "newbie" } });
    expect(f.cardSurfaces).toEqual([f.surfaceExchanges]);
    expect(f.cardOptions[0]?.frameSize).toEqual(["1px", "1px"]);
    expect(f.forms).toEqual([{ title: "Create the user newbie?", description: "A new login named newbie (newbie@example.test) will be created with no roles. Type their first password below.",
      submitLabel: "Create user", fields: [{ kind: "string", name: "password", label: "Password", hint: "Typed here only, never shown to the assistant.", required: true, secret: true }],
      cancelLabel: "Cancel", app: { appName: "form-app", appVersion: "1", showSecret: "show", hideSecret: "hide" }, preferredFrameSize: ["100%", "360px"] }]);
    expect(f.outcomes).toEqual([{ title: "User created", details: [{ label: "Username", value: "newbie" }], state: "success",
      message: "newbie can now sign in with the password you typed.", app: { appName: "outcome-app", appVersion: "1", showSecret: "show", hideSecret: "hide" }, preferredFrameSize: ["100%", "240px"] }]);
    const users = await f.repos.users.list({ workspaceId: "ws" });
    expect(users.find((u) => u.username === "newbie")?.passwordHash).toBe("hash-x");
  });

  it("creates nothing when the password is left blank", async () => {
    const f = await fixture({ card: { status: "blank" } });
    expect(await f.tool("identity_user_create").handler(ctx(f.ownerPrincipalId, { username: "newbie" })))
      .toEqual({ created: false, cancelled: false, note: "The user submitted no password. Nothing was created." });
    expect(f.forms[0]?.description).toBe("A new login named newbie will be created with no roles. Type their first password below.");
    expect(f.forms[0]).not.toHaveProperty("app");
    expect(f.outcomes).toEqual([{ title: "User not created", details: [{ label: "Username", value: "newbie" }], state: "failure",
      message: "No password was entered. Nothing was created.", preferredFrameSize: ["100%", "240px"] }]);
    expect((await f.repos.users.list({ workspaceId: "ws" })).map((u) => u.username)).toEqual(["owner"]);
  });

  it("maps a declined card to 'declined' and an expired one to its own status, with no outcome card", async () => {
    const declined = await fixture({ card: { status: "cancelled" } });
    expect(await declined.tool("identity_user_create").handler(ctx(declined.ownerPrincipalId, { username: "newbie" }))).toEqual({ created: false, confirmed: false, reason: "declined" });
    expect(declined.outcomes).toEqual([undefined]);
    const expired = await fixture({ card: { status: "expired" } });
    expect(await expired.tool("identity_user_create").handler(ctx(expired.ownerPrincipalId, { username: "newbie" }))).toEqual({ created: false, confirmed: false, reason: "expired" });
  });

  it("a failed save shows the safe message on the card and is rethrown as a tool error", async () => {
    const f = await fixture();
    const error: unknown = await f.tool("identity_user_create").handler(ctx(f.ownerPrincipalId, { username: "owner" })).then(() => null, (caught: unknown) => caught);
    expect(error).toBeInstanceOf(ToolInputError);
    const outcome = f.outcomes[0];
    expect(outcome?.state).toBe("failure");
    expect(outcome?.title).toBe("User not created");
    expect((error as Error).message).toBe(outcome?.message);
    expect(outcome?.message).not.toContain("pw-typed");
  });

  it("names only the normalized username for a known conflict and hides any other failure detail", async () => {
    const f = await fixture();
    await f.tool("identity_user_create").handler(ctx(f.ownerPrincipalId, { username: "Newbie" }));
    const safeError = f.cardOptions[0]?.safeError;
    expect(safeError?.(new PackageIdentityConflictError({ message: "raw detail pw-typed" }))).toBe("username 'newbie' is already in use");
    expect(safeError?.(new Error("hash of pw-typed failed"))).toBeUndefined();
  });

  it("refuses a caller without user.manage before the card is drawn", async () => {
    const f = await fixture();
    await f.repos.principals.save({ id: "nobody", workspaceId: "ws", kind: "user", displayName: "Nobody", status: "active", createdAt: "t" });
    await expect(f.tool("identity_user_create").handler(ctx("nobody", { username: "newbie" }))).rejects.toThrow(/user\.manage/);
    expect(f.forms).toEqual([]);
  });
});

describe("identity_user_disable / identity_user_enable account gate", () => {
  it("runs the wrapped tool when the guard allows it", async () => {
    const f = await fixture();
    await f.repos.principals.save({ id: "worker", workspaceId: "ws", kind: "user", displayName: "Worker", status: "disabled", disabledAt: "t", createdAt: "t" });
    await f.repos.users.save({ principalId: "worker", workspaceId: "ws", username: "worker", passwordHash: "h", version: 1 });
    await f.tool("identity_user_enable").handler(ctx(f.ownerPrincipalId, { principalId: "worker" }));
    expect((await f.repos.principals.findById({ workspaceId: "ws", id: "worker" }))?.status).toBe("active");
  });

  it("turns a self-disable into a SELF_DELETE tool error and changes nothing", async () => {
    const f = await fixture();
    await expect(f.tool("identity_user_disable").handler(ctx(f.ownerPrincipalId, { principalId: f.ownerPrincipalId })))
      .rejects.toThrow("identity_user_disable: SELF_DELETE: you cannot disable your own account. Nothing was changed.");
    expect((await f.repos.principals.findById({ workspaceId: "ws", id: f.ownerPrincipalId }))?.status).toBe("active");
  });

  it("turns an owner refusal into OWNER_REQUIRED and passes any other failure through unchanged", async () => {
    const owner = await fixture({ accountAction: async () => { throw new PackageOwnerRequiredError({ message: "only an owner can do that" }); } });
    await expect(owner.tool("identity_user_disable").handler(ctx(owner.ownerPrincipalId, { principalId: "x" })))
      .rejects.toThrow("identity_user_disable: OWNER_REQUIRED: only an owner can do that. Nothing was changed.");
    const boom = new Error("storage down");
    const other = await fixture({ accountAction: async () => { throw boom; } });
    await expect(other.tool("identity_user_enable").handler(ctx(other.ownerPrincipalId, { principalId: "x" }))).rejects.toBe(boom);
  });
});

it("contributeIdentityTools exposes the gated builder under the identity domain with the given risk", () => {
  const contributor = contributeIdentityTools({ identityDerivedRisk });
  expect(contributor.domain).toBe("identity");
  expect(contributor.build).toBe(buildGatedIdentityRegistrations);
  expect(contributor.risk).toBe(identityDerivedRisk);
});
