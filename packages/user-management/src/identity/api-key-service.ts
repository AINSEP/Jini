import type { ISODateTime, UUID } from "@jini-ai/core/primitives";
import { GrantExceedsIssuerError, IdentityNotFoundError, IdentityValidationError, type PolicyPermissionRecord, type PrincipalRecord } from "../core/index.js";
import { resolveEffectivePermissions } from "../server/authorize.js";
import type { AuthServiceDeps } from "../server/auth-service.js";
import { assertCallerHasAnyPermission, authorizeDepsFrom } from "../server/grant-service.js";

import { decoyKeyHash, type ApiKeySecret, type MintedApiKey } from "./api-key-secret.js";
import type { ApiKeyRecord, ApiKeyRepoPort, ApiKeySecretHasherPort } from "./api-key-types.js";

/**
 * @file The three API-key transitions (`CREATE_PRINCIPAL` for `kind='api_key'`, `ISSUE_API_KEY`,
 * `REVOKE_API_KEY` — state.spec §3) plus the verification path that turns a presented raw key back
 * into a principal (SPEC-006 REQ-08).
 *
 * Purpose:
 * `@jini-ai/user-management`'s own `INFO.md` scopes API keys OUT of that library ("Out of scope,
 * deferred: API keys (`api_keys`, `ISSUE_API_KEY`)"), so this host implements them, against that
 * library's exported ports and errors rather than a parallel vocabulary. Every error thrown here
 * is one the users/roles/policies routes already map to a status code, so the api-keys routes'
 * error envelopes are the same envelopes, not new ones.
 *
 * Architectural role:
 * Ordinary domain functions in the `func(required, options)` shape the rest of `identity` uses —
 * no Express, no db handle, no `RouteDeps`. The route layer supplies `ApiKeyServiceDeps` and maps
 * thrown errors onto HTTP; nothing here knows a status code.
 *
 * ## Two invariants this file exists to hold
 *
 * 1. **A key's authority is a frozen snapshot, never a live reference** (REQ-08/F-054-01).
 *    `issueApiKey` copies the requested policies' permission rows field-identically into a NEW
 *    `isFrozen` policy and attaches THAT to the bound principal. A later widening of a source
 *    policy therefore cannot grow an already-issued key.
 * 2. **A key never out-ranks its issuer** (INV-07). Every permission the snapshot would confer
 *    must be held UNCONSTRAINED by the caller, or issuance is refused with no rows written.
 *    `@jini-ai/user-management` implements this clamp for `ASSIGN_ROLE`/`ATTACH_POLICY` but does not
 *    export it (`grant-service.ts` is not on the package's `exports` map), so `assertGrantClamp`
 *    below is a deliberate re-implementation over the exported `resolveEffectivePermissions`,
 *    matching that function's semantics exactly — including that the owner wildcard `*` counts as
 *    an unconstrained hold of everything.
 */

/** Post-trim bounds shared by `displayName` and `label` (api.spec §1, both `1..255`). */
const NAME_MIN_LENGTH = 1;
const NAME_MAX_LENGTH = 255;

/** The single permission gating all three transitions (api.spec §2, `AUTH_APIKEY_MANAGE`). */
const APIKEY_MANAGE = "apikey.manage";

/** Deps the transitions below need: the nine identity repos plus the two api-key-specific seams. */
export interface ApiKeyServiceDeps extends AuthServiceDeps {
  apiKeys: ApiKeyRepoPort;
  secretHasher: ApiKeySecretHasherPort;
}

// Repo-bag assembly and its sharing rationale now live in Jini user-management/server (grant-service.ts).

/** Trim-and-bound one of the two name fields, or throw `IdentityValidationError`. */
function requireBoundedName({ value, field }: { value: unknown; field: string }, _options = {}): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed.length < NAME_MIN_LENGTH || trimmed.length > NAME_MAX_LENGTH) {
    throw new IdentityValidationError({ message: `'${field}' must be ${NAME_MIN_LENGTH}..${NAME_MAX_LENGTH} characters after trimming` });
  }
  return trimmed;
}

/** True iff `rows` carries `permission` with BOTH `resourceType` and `constraintJson` null — or the
 *  owner wildcard, which is an unconstrained hold of every permission (INV-07). */
function holdsUnconstrained({ rows, permission }: { rows: readonly PolicyPermissionRecord[]; permission: string }, _options = {}): boolean {
  const unconstrained = ({ row, id }: { row: PolicyPermissionRecord; id: string }, _options = {}) =>
    row.permission === id && row.resourceType == null && row.constraintJson == null;
  return rows.some((row) => unconstrained({ row, id: "*" })) || rows.some((row) => unconstrained({ row, id: permission }));
}

/**
 * The INV-07 grant-authority clamp for issuance: refuse unless the caller holds every permission
 * the snapshot would confer, unconstrained. A conditionally-held permission (resource-scoped or
 * constraint-bound) cannot be delegated at all.
 *
 * @throws {GrantExceedsIssuerError} naming every offending permission. No row is written — callers
 *   run this before any save.
 * @complexity O(resolveEffectivePermissions) + O(k), k = distinct conferred permissions.
 * @overallScore 100
 */
async function assertGrantClamp(required: {
  deps: ApiKeyServiceDeps;
  workspaceId: UUID;
  callerPrincipalId: UUID;
  conferredPermissions: readonly string[];
}): Promise<void> {
  const distinct = [...new Set(required.conferredPermissions)];
  if (distinct.length === 0) return;

  const effectiveRows = await resolveEffectivePermissions({
    deps: authorizeDepsFrom(required.deps.repos),
    principalId: required.callerPrincipalId,
    workspaceId: required.workspaceId,
  });

  const offending = distinct.filter((permission) => !holdsUnconstrained({ rows: effectiveRows, permission }));
  if (offending.length > 0) {
    throw new GrantExceedsIssuerError({ message: `principal '${required.callerPrincipalId}' cannot grant permission(s) it does not hold unconstrained: ${offending.join(", ")}`, offendingPermissions: offending });
  }
}

/** The `apikey.manage` gate every transition here runs FIRST — before reading the body and before
 *  any existence lookup, so an unauthorized caller learns nothing about whether a target exists. */
function assertCallerMayManageApiKeys(required: {
  deps: ApiKeyServiceDeps;
  workspaceId: UUID;
  callerPrincipalId: UUID;
}): Promise<void> {
  return assertCallerHasAnyPermission({
    deps: required.deps,
    workspaceId: required.workspaceId,
    callerPrincipalId: required.callerPrincipalId,
    permissions: [APIKEY_MANAGE],
  });
}

export interface CreateApiKeyPrincipalInput {
  workspaceId: UUID;
  callerPrincipalId: UUID;
  displayName: unknown;
  /** Optional; only `"api_key"` (or absent) is accepted — see the refusal below. */
  kind?: unknown;
}

/**
 * `CREATE_PRINCIPAL` for machine identities (api.spec §1 `APIKEY_PRINCIPAL_CREATE`, 0.7.0). Mints
 * an ACTIVE, GRANTLESS `kind='api_key'` principal — no `principal_roles`, no `principal_policies`
 * — which is exactly the precondition `issueApiKey` re-verifies.
 *
 * `kind` is accepted but constrained to `"api_key"`: humans are minted only by `CREATE_USER` and
 * `system`/`user-local` only by first-boot seeding, so this endpoint can never become a second
 * creation path for a privileged kind. `workspaceId` comes from the caller's own credential; there
 * is no caller-supplied workspace field and therefore no cross-workspace mint.
 *
 * @throws {IdentityForbiddenError} caller lacks `apikey.manage` (403).
 * @throws {IdentityValidationError} blank/oversize `displayName`, or `kind` other than `api_key` (400).
 * @complexity O(1) — one permission check, one save.
 * @overallScore 100
 */
export async function createApiKeyPrincipal(required: {
  deps: ApiKeyServiceDeps;
  input: CreateApiKeyPrincipalInput;
}): Promise<{ principal: PrincipalRecord }> {
  const { deps, input } = required;

  await assertCallerMayManageApiKeys({
    deps,
    workspaceId: input.workspaceId,
    callerPrincipalId: input.callerPrincipalId,
  });

  if (input.kind !== undefined && input.kind !== "api_key") {
    throw new IdentityValidationError({ message: `'kind' must be 'api_key', got '${String(input.kind)}'` });
  }
  const displayName = requireBoundedName({ value: input.displayName, field: "displayName" });

  const principal: PrincipalRecord = {
    id: deps.idGen.newId(),
    workspaceId: input.workspaceId,
    kind: "api_key",
    displayName,
    status: "active",
    createdAt: new Date(deps.clock.nowMs()).toISOString(),
  };
  await deps.repos.principals.save(principal);

  return { principal };
}

export interface IssueApiKeyInput {
  workspaceId: UUID;
  callerPrincipalId: UUID;
  principalId: unknown;
  label: unknown;
  policyIds: unknown;
  expiresAt?: unknown;
}

/** Read `policyIds` off an untyped body: a non-empty array of non-blank strings, or 400. */
function requirePolicyIds({ value }: { value: unknown }, _options = {}): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new IdentityValidationError({ message: "'policyIds' must be a non-empty array of policy ids" });
  }
  return value.map((entry) => {
    const id = typeof entry === "string" ? entry.trim() : "";
    if (id.length === 0) throw new IdentityValidationError({ message: "'policyIds' entries must be non-blank policy ids" });
    return id;
  });
}

/** The bound principal must exist, be `kind='api_key'`, and be grantless (AC-23/AC-25). */
async function findIssuableTargetOrThrow(required: {
  deps: ApiKeyServiceDeps;
  workspaceId: UUID;
  principalId: UUID;
}): Promise<PrincipalRecord> {
  const { deps, workspaceId, principalId } = required;

  const target = await deps.repos.principals.findById({ workspaceId, id: principalId });
  if (!target) throw new IdentityNotFoundError({ message: `principal '${principalId}' was not found` });

  if (target.kind !== "api_key") {
    throw new IdentityValidationError({ message: `ISSUE_API_KEY target must be a machine (kind='api_key') principal, got kind='${target.kind}'` });
  }
  if (target.status !== "active") {
    throw new IdentityValidationError({ message: `principal '${principalId}' is disabled` });
  }

  const [roleGrants, policyGrants] = await Promise.all([
    deps.repos.principalRoles.listByPrincipalId({ workspaceId, principalId }),
    deps.repos.principalPolicies.listByPrincipalId({ workspaceId, principalId }),
  ]);
  if (roleGrants.length > 0 || policyGrants.length > 0) {
    throw new IdentityValidationError({ message: `principal '${principalId}' already carries grants; ISSUE_API_KEY requires a grantless principal so the key's authority equals exactly the policies attached here` });
  }

  return target;
}

/** Resolve the source policies' permission rows, refusing a `*`-bearing source (AC-26). */
async function collectSnapshotSourceRows(required: {
  deps: ApiKeyServiceDeps;
  workspaceId: UUID;
  policyIds: readonly string[];
}): Promise<PolicyPermissionRecord[]> {
  const { deps, workspaceId, policyIds } = required;
  const rows: PolicyPermissionRecord[] = [];

  for (const policyId of policyIds) {
    const policy = await deps.repos.policies.findById({ workspaceId, id: policyId });
    if (!policy) throw new IdentityNotFoundError({ message: `policy '${policyId}' was not found` });

    const policyRows = await deps.repos.policyPermissions.listByPolicyId({ workspaceId, policyId });
    if (policyRows.some((row) => row.permission === "*")) {
      throw new IdentityValidationError({ message: `policy '${policyId}' carries the owner wildcard '*'; an API-key snapshot may never carry it` });
    }
    rows.push(...policyRows);
  }

  return rows;
}

/** Optional `expiresAt`: absent/null means no expiry; anything else must parse as a real date. */
function readOptionalExpiry({ value }: { value: unknown }, _options = {}): ISODateTime | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = new Date(String(value)).getTime();
  if (Number.isNaN(parsed)) {
    throw new IdentityValidationError({ message: "'expiresAt' must be an ISO-8601 date-time or null" });
  }
  // Canonicalized to UTC on the way in, so the stored value is comparable by instant and never by
  // accident of the offset the caller happened to send.
  return new Date(parsed).toISOString();
}
function apiKeyPolicySnapshot({ snapshotPolicyId, workspaceId, keyId, label }: { snapshotPolicyId: string; workspaceId: UUID; keyId: string; label: string }): Parameters<ApiKeyServiceDeps['repos']['policies']['save']>[0] {
  return { version: 1,
      id: snapshotPolicyId,
      workspaceId,
      name: `api-key:${keyId}`,
      description: `Issuance snapshot for API key '${label}'`,
      isBuiltin: false,
      isFrozen: true,
    };
}

function apiKeySnapshotPermission({ deps, workspaceId, snapshotPolicyId, row }: { deps: ApiKeyServiceDeps; workspaceId: UUID; snapshotPolicyId: string; row: Awaited<ReturnType<typeof collectSnapshotSourceRows>>[number] }): Parameters<ApiKeyServiceDeps['repos']['policyPermissions']['save']>[0] {
  return {
        id: deps.idGen.newId(),
        workspaceId,
        policyId: snapshotPolicyId,
        permission: row.permission,
        resourceType: row.resourceType ?? null,
        constraintJson: row.constraintJson ?? null,
      };
}

function issuedApiKeyRecord({ deps, keyId, workspaceId, boundPrincipalId, label, minted, snapshotPolicyId, expiresAt }: {
  deps: ApiKeyServiceDeps; keyId: string; workspaceId: UUID; boundPrincipalId: string; label: string;
  minted: MintedApiKey; snapshotPolicyId: string; expiresAt: ApiKeyRecord['expiresAt'];
}, keyHash: string): ApiKeyRecord {
  return {
      id: keyId,
      workspaceId,
      principalId: boundPrincipalId,
      label,
      keyHash,
      prefix: minted.prefix,
      issuedPolicyId: snapshotPolicyId,
      createdAt: new Date(deps.clock.nowMs()).toISOString(),
      expiresAt,
    };
}



/**
 * `ISSUE_API_KEY` (state.spec §3). Snapshots the requested policies into a fresh `isFrozen` policy,
 * attaches it to the bound `kind='api_key'` principal, and returns the raw key ONCE.
 *
 * The raw key is the only value in this codebase that is returned and never stored: `api_keys`
 * holds a digest of its secret half plus its non-secret prefix, so no later read of any table can
 * reconstruct it (INV-05).
 *
 * Writes happen only after every check passes, in this order: validate body (400) → resolve target
 * (404/400) → resolve sources (404/400) → INV-07 clamp (403) → write. A refused issuance therefore
 * leaves no partial rows, including no orphan frozen policy.
 *
 * @throws {IdentityForbiddenError} caller lacks `apikey.manage` (403).
 * @throws {IdentityValidationError} bad body, non-`api_key` target, non-grantless target, or a
 *   `*`-bearing source policy (400).
 * @throws {IdentityNotFoundError} unknown principal or policy (404).
 * @throws {GrantExceedsIssuerError} the snapshot would exceed the issuer's own authority (403).
 * @complexity O(p) repo reads for p source policies, plus one `resolveEffectivePermissions`, plus
 *   O(k) writes for the k permission rows copied.
 * @overallScore 100
 */
export async function issueApiKey(required: {
  deps: ApiKeyServiceDeps;
  input: IssueApiKeyInput;
  keySecret: ApiKeySecret;
}, _optional: Record<string, never> = {}): Promise<{ apiKey: ApiKeyRecord; rawKey: string }> {
  const { deps, input } = required;
  const { workspaceId } = input;

  // The grantless read and every snapshot/key write share the existing workspace lock.
  const execute = async () => {
    await assertCallerMayManageApiKeys({
      deps,
      workspaceId,
      callerPrincipalId: input.callerPrincipalId,
    });

    const label = requireBoundedName({ value: input.label, field: "label" });
    const policyIds = requirePolicyIds({ value: input.policyIds });
    const expiresAt = readOptionalExpiry({ value: input.expiresAt });
    const boundPrincipalId = typeof input.principalId === "string" ? input.principalId.trim() : "";
    if (boundPrincipalId.length === 0) {
      throw new IdentityValidationError({ message: "'principalId' is required" });
    }

    await findIssuableTargetOrThrow({ deps, workspaceId, principalId: boundPrincipalId });
    const sourceRows = await collectSnapshotSourceRows({ deps, workspaceId, policyIds });

    await assertGrantClamp({
      deps,
      workspaceId,
      callerPrincipalId: input.callerPrincipalId,
      conferredPermissions: sourceRows.map((row) => row.permission),
    });

    const keyId = deps.idGen.newId();
    const snapshotPolicyId = deps.idGen.newId();

    // The frozen snapshot: a machine-owned policy, 1:1 with this key. `name` embeds the key id so it
    // is unique per workspace (the `policies` table's own uniqueness constraint) without a retry loop.
    await deps.repos.policies.save(apiKeyPolicySnapshot({ snapshotPolicyId, workspaceId, keyId, label }));

    // Copied field-identically — `resourceType`/`constraintJson` are preserved per row and never
    // widened. A snapshot that dropped a constraint would grant MORE than its source.
    for (const row of sourceRows) {
      await deps.repos.policyPermissions.save(apiKeySnapshotPermission({ deps, workspaceId, snapshotPolicyId, row }));
    }

    await deps.repos.principalPolicies.save({
      id: deps.idGen.newId(),
      workspaceId,
      principalId: boundPrincipalId,
      policyId: snapshotPolicyId,
    });

    const minted = required.keySecret.mintApiKey();
    const apiKey: ApiKeyRecord = issuedApiKeyRecord({ deps, keyId, workspaceId, boundPrincipalId, label, minted, snapshotPolicyId, expiresAt }, await deps.secretHasher.hash({ secret: minted.secret }));
    await deps.apiKeys.save(apiKey);

    return { apiKey, rawKey: minted.rawKey };
  };
  return deps.repos.transactions.run({ workspaceId, execute });
}

/**
 * `REVOKE_API_KEY` (state.spec §3). Sets `revokedAt` and empties the key's issuance snapshot, so
 * the next request presenting the key is rejected AND the bound principal is left holding nothing.
 * Idempotent: revoking an already-revoked key succeeds without moving the original timestamp.
 *
 * **Disclosed deviation from state.spec §3.** That row calls for retiring the snapshot policy
 * outright — "its `principal_policies` row + the frozen `policies` row + its `policy_permissions`".
 * `PrincipalPolicyRepoPort` (`@jini-ai/user-management`) exposes only `listByPrincipalId`/
 * `listByPolicyId`/`save`, with no delete, and the port is not this repo's to change. Deleting the
 * `policies` row while its join row survives would leave exactly the dangling reference INV-09
 * exists to prevent, so this instead empties the snapshot via `deleteByPolicyId` and leaves the
 * (now permission-less, still `isFrozen`) policy and its join row in place. The security outcome is
 * identical — the principal's effective permission set is empty — and no invariant is broken.
 *
 * @throws {IdentityForbiddenError} caller lacks `apikey.manage` (403).
 * @throws {IdentityNotFoundError} no such key in the caller's workspace (404).
 * @complexity O(1) repo operations.
 * @overallScore 100
 */
export async function revokeApiKey(required: {
  deps: ApiKeyServiceDeps;
  input: { workspaceId: UUID; callerPrincipalId: UUID; keyId: string };
}): Promise<{ apiKey: ApiKeyRecord }> {
  const { deps, input } = required;

  await assertCallerMayManageApiKeys({
    deps,
    workspaceId: input.workspaceId,
    callerPrincipalId: input.callerPrincipalId,
  });

  const existing = await deps.apiKeys.findById({ workspaceId: input.workspaceId, id: input.keyId });
  if (!existing) throw new IdentityNotFoundError({ message: `api key '${input.keyId}' was not found` });

  const revoked: ApiKeyRecord = { ...existing, revokedAt: existing.revokedAt ?? new Date(deps.clock.nowMs()).toISOString() };
  await deps.apiKeys.save(revoked);

  if (revoked.issuedPolicyId) {
    await deps.repos.policyPermissions.deleteByPolicyId({
      workspaceId: input.workspaceId,
      policyId: revoked.issuedPolicyId,
    });
  }

  return { apiKey: revoked };
}

/** True iff `candidate` is still usable: not revoked, not expired, and bound to an `active`
 *  `kind='api_key'` principal — the checks {@link authenticateApiKey} runs AFTER verification, so
 *  they never short-circuit ahead of the constant-time comparison (see that function's own doc). */
function isCandidateStillUsable(
  candidate: ApiKeyRecord,
  principal: PrincipalRecord | null,
  nowIso: string
): principal is PrincipalRecord {
  if (candidate.revokedAt) return false;
  // Compared as instants, not as strings — a row written before `readOptionalExpiry` canonicalized
  // expiries, or by a future writer, must not be mis-ordered by its offset notation.
  if (candidate.expiresAt && Date.parse(candidate.expiresAt) <= Date.parse(nowIso)) return false;
  return principal?.status === "active" && principal.kind === "api_key";
}

/**
 * Resolve a presented raw key to its principal, applying every fail-closed check. The Bearer-auth
 * counterpart of `@jini-ai/user-management`'s `validateSession`, and deliberately the same shape: it
 * returns `null` for EVERY rejection reason rather than throwing a distinguishable error, so a
 * caller cannot tell "unknown key" from "revoked key" from "expired key" from "disabled principal".
 *
 * Timing is handled the same way. A prefix that matches no row still spends one real key
 * derivation against `decoyKeyHash`, so an attacker cannot enumerate valid prefixes by clocking
 * the response; and the revoked/expired/status checks run AFTER verification, so they never
 * short-circuit ahead of the constant-time comparison.
 *
 * @returns the bound principal and its key row, or `null` — never a reason.
 * @complexity O(1) — one indexed row read, one key derivation, one principal read, one save.
 * @overallScore 100
 */
export async function authenticateApiKey(required: {
  deps: ApiKeyServiceDeps;
  input: { workspaceId: UUID; rawKey: string };
  keySecret: ApiKeySecret;
}): Promise<{ principal: PrincipalRecord; apiKey: ApiKeyRecord } | null> {
  const { deps, input } = required;

  const parsed = required.keySecret.parseApiKey({ rawKey: input.rawKey });
  if (!parsed) return null;

  const candidate = await deps.apiKeys.findByPrefix({
    workspaceId: input.workspaceId,
    prefix: parsed.prefix,
  });
  if (!candidate) {
    await deps.secretHasher.verify({ storedHash: await decoyKeyHash({ hasher: deps.secretHasher }), secret: parsed.secret });
    return null;
  }

  const matches = await deps.secretHasher.verify({ storedHash: candidate.keyHash, secret: parsed.secret });
  if (!matches) return null;

  const now = new Date(deps.clock.nowMs()).toISOString();
  const principal = await deps.repos.principals.findById({
    workspaceId: input.workspaceId,
    id: candidate.principalId,
  });
  if (!isCandidateStillUsable(candidate, principal, now)) return null;

  await deps.apiKeys.save({ ...candidate, lastUsedAt: now });

  return { principal, apiKey: candidate };
}

/** Bind the host's key format (`createApiKeySecret`) once at composition; call sites keep `{ deps, input }`. */
export function createApiKeyService({ keySecret }: { keySecret: ApiKeySecret }, _optional: Record<string, never> = {}) {
  return {
    issueApiKey: (required: Omit<Parameters<typeof issueApiKey>[0], "keySecret">) => issueApiKey({ ...required, keySecret }),
    authenticateApiKey: (required: Omit<Parameters<typeof authenticateApiKey>[0], "keySecret">) => authenticateApiKey({ ...required, keySecret }),
  };
}
