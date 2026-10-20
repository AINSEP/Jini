import { createTransactionalInMemoryIdentityRepos } from "../repo.memory-transactions.js";
import {
  InMemoryPolicyPermissionRepo,
  InMemoryPolicyRepo,
  InMemoryPrincipalPolicyRepo,
  InMemoryPrincipalRepo,
  InMemoryPrincipalRoleRepo,
  InMemoryRolePolicyRepo,
  InMemoryRoleRepo,
  InMemorySessionRepo,
  InMemoryUserRepo,
} from "../repo.memory.js";
import type { IdentityRepos, PasswordHasherPort } from "../../core/ports.js";
import type { SessionTokenPort } from "../../core/runtime-ports.js";

/**
 * @file Call-trace fixture for the auth-service / seed / permission-migrations pin tests.
 *
 * Why a trace and not just end-state assertions: these three files are security-sensitive and were
 * refactored for complexity. A refactor that reorders a lookup (e.g. hitting the user repo before
 * rejecting an empty password) or adds an extra write would leave most end-state assertions green.
 * Recording every repo/hasher/token call in order makes "behaviour is identical" checkable: the pin
 * tests assert the exact call sequence for each branch, so the trace on the old code IS the spec.
 */

export const WORKSPACE = "ws-pin";

export interface TraceHarness {
  repos: IdentityRepos;
  /** Every recorded call as `"<port>.<method>"`, in call order. */
  calls: string[];
  /** Ids handed out so far by `idGen`. */
  idGen: { newId: () => string };
  hasher: PasswordHasherPort;
  tokens: SessionTokenPort;
  clock: { nowMs: () => number };
  setNow: (iso: string) => void;
}

/** Wrap every function-valued member of `target` so calling it appends `"<label>.<method>"` to `calls`. */
function traced<T extends object>(target: T, label: string, calls: string[]): T {
  return new Proxy(target, {
    get(obj, key, receiver) {
      const value: unknown = Reflect.get(obj, key, receiver);
      if (typeof value !== "function" || typeof key !== "string") return value;
      return (...args: unknown[]) => {
        calls.push(`${label}.${key}`);
        return (value as (...a: unknown[]) => unknown).apply(obj, args);
      };
    },
  });
}

/**
 * In-memory identity repos with deterministic ids (`id-1`, `id-2`, …), a fast fake hasher
 * (`hash:<password>`), deterministic tokens (`tok-1`, … hashed as `th:<token>`), and a settable clock.
 */
export function buildTraceHarness(nowIso = "2026-07-10T00:00:00.000Z"): TraceHarness {
  const calls: string[] = [];
  const base = createTransactionalInMemoryIdentityRepos({
    repos: {
      principals: new InMemoryPrincipalRepo({}),
      users: new InMemoryUserRepo({}),
      sessions: new InMemorySessionRepo({}),
      roles: new InMemoryRoleRepo({}),
      policies: new InMemoryPolicyRepo({}),
      policyPermissions: new InMemoryPolicyPermissionRepo({}),
      rolePolicies: new InMemoryRolePolicyRepo({}),
      principalRoles: new InMemoryPrincipalRoleRepo({}),
      principalPolicies: new InMemoryPrincipalPolicyRepo({}),
    },
  });
  const repos: IdentityRepos = {
    transactions: traced(base.transactions, "transactions", calls),
    principals: traced(base.principals, "principals", calls),
    users: traced(base.users, "users", calls),
    sessions: traced(base.sessions, "sessions", calls),
    roles: traced(base.roles, "roles", calls),
    policies: traced(base.policies, "policies", calls),
    policyPermissions: traced(base.policyPermissions, "policyPermissions", calls),
    rolePolicies: traced(base.rolePolicies, "rolePolicies", calls),
    principalRoles: traced(base.principalRoles, "principalRoles", calls),
    principalPolicies: traced(base.principalPolicies, "principalPolicies", calls),
  };
  let counter = 0;
  let tokenCounter = 0;
  let currentNow = nowIso;
  const hasher: PasswordHasherPort = {
    hash: async ({ password }) => {
      calls.push("hasher.hash");
      return `hash:${password}`;
    },
    verify: async ({ hash, password }) => {
      calls.push("hasher.verify");
      return hash === `hash:${password}`;
    },
  };
  const tokens: SessionTokenPort = {
    newToken: () => {
      calls.push("tokens.newToken");
      return `tok-${++tokenCounter}`;
    },
    hashToken: ({ rawToken }) => {
      calls.push("tokens.hashToken");
      return `th:${rawToken}`;
    },
  };
  return {
    repos,
    calls,
    idGen: { newId: () => `id-${++counter}` },
    hasher,
    tokens,
    clock: { nowMs: () => Date.parse(currentNow) },
    setNow: (iso) => {
      currentNow = iso;
    },
  };
}
