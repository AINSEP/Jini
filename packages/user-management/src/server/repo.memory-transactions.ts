import { AsyncLocalStorage } from 'node:async_hooks';
import type { IdentityRepos, IdentityTransactionPort } from '../core/ports.js';
import { InMemoryIdentityRows } from './repo.memory.js';

/**
 * Wrap a complete memory repository bag with one serialization queue and rollback snapshots.
 * Use only the returned repositories after binding: retained raw handles bypass isolation.
 * Every ordinary read/write also joins the queue, so an assignment outside a service cannot
 * race a guarded delete and readers cannot observe uncommitted changes. This is a dev/test
 * adapter; durable hosts supply their own transaction port over their own storage connection.
 */
export function createTransactionalInMemoryIdentityRepos(required: {
  repos: Omit<IdentityRepos, "transactions"> & { transactions?: IdentityTransactionPort };
}): IdentityRepos & { transactions: IdentityTransactionPort } {
  if (required.repos.transactions) throw new Error('identity repositories are already bound to a transaction port');
  const context = new AsyncLocalStorage<{ active: boolean }>();
  let tail = Promise.resolve();
  const stores = Object.entries(required.repos).filter(([key]) => key !== 'transactions');
  for (const [, repo] of stores) {
    if (!(repo instanceof InMemoryIdentityRows)) {
      throw new Error('memory transactions require in-memory identity repositories');
    }
  }

  /** Preserve queue progress after rejection; descendants of a completed body cannot bypass it. */
  async function exclusive<T>(execute: () => Promise<T>): Promise<T> {
    if (context.getStore()?.active) return execute();
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    const scope = { active: true };
    try {
      return await context.run(scope, execute);
    } finally {
      scope.active = false;
      release();
    }
  }

  const transactions: IdentityTransactionPort = {
    run: ({ execute }) => exclusive(async () => {
      const snapshots = stores.map(([, repo]) => {
        if (!(repo instanceof InMemoryIdentityRows)) throw new Error('memory transactions require in-memory identity repositories');
        const rows = repo.snapshotRows({});
        return { restore: () => repo.restoreRows({ rows }) };
      });
      try {
        return await execute();
      } catch (error) {
        for (const snapshot of snapshots) snapshot.restore();
        throw error;
      }
    }),
  };
  function wrap<T extends object>(repo: T): T {
    return new Proxy(repo, {
      get(target, property, receiver) {
        const member = Reflect.get(target, property, receiver);
        if (typeof member !== 'function') return member;
        return (...args: unknown[]) => exclusive(async () => {
          // Detach inputs/outputs so a row reference outside the queue cannot mutate stored state.
          const result = await Reflect.apply(member, target, structuredClone(args));
          return structuredClone(result);
        });
      },
    });
  }
  const repos = {
    principals: wrap(required.repos.principals), users: wrap(required.repos.users),
    sessions: wrap(required.repos.sessions), roles: wrap(required.repos.roles),
    policies: wrap(required.repos.policies), policyPermissions: wrap(required.repos.policyPermissions),
    rolePolicies: wrap(required.repos.rolePolicies), principalRoles: wrap(required.repos.principalRoles),
    principalPolicies: wrap(required.repos.principalPolicies),
  };
  return { ...repos, transactions };
}
