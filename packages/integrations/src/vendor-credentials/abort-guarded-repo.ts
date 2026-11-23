import type { VaultRepoPort } from "@jini-ai/core/contracts/vault";

/**
 * Wraps the credential repo so every persistence write (insert/update and the vault's put/applyBatch)
 * first refuses an aborted signal; reads, deletes and non-function vault members pass straight through.
 * Extracted from `saveProposedCredential` so the guard is testable against a hand-written repo.
 * @complexity O(1) wiring; each call costs what the wrapped repo's call costs.
 */
export function abortGuardedCredentialRepo<T extends { readonly vault?: VaultRepoPort }>({ store, signal }: { store: T; signal: AbortSignal }, _optional = {}): T {
  // Since secrets_vault (9b20083b6) create/update write through repo.vault, both write surfaces
  // must refuse cancellation after asynchronous sealing. Preserve each domain's own repo ABI.
  const vault = store.vault && new Proxy(store.vault, { get(target, key) {
    const value = Reflect.get(target, key);
    if (typeof value !== 'function') return value;
    return (...args: unknown[]) => {
      if (key === 'put' || key === 'applyBatch') signal.throwIfAborted();
      return value.apply(target, args);
    };
  } });
  // A store's project half (`custom-credentials/types.ts`'s `repo.project`) writes too: guarded alike.
  const project = (store as { readonly project?: { readonly repo: { readonly vault?: VaultRepoPort }; readonly createRepo?: { readonly vault?: VaultRepoPort }; readonly replaceRepo?: { readonly vault?: VaultRepoPort } } }).project;
  const guardedProject = project && { ...project, repo: abortGuardedCredentialRepo({ store: project.repo, signal }),
    ...(project.createRepo ? { createRepo: abortGuardedCredentialRepo({ store: project.createRepo, signal }) } : {}),
    ...(project.replaceRepo ? { replaceRepo: abortGuardedCredentialRepo({ store: project.replaceRepo, signal }) } : {}),
  };
  return new Proxy(store, { get(target, key) {
    if (key === 'vault') return vault;
    if (key === 'project') return guardedProject;
    const value = Reflect.get(target, key);
    if (typeof value !== 'function') return value;
    return (...args: unknown[]) => {
      if (key === 'insert' || key === 'update') signal.throwIfAborted();
      return value.apply(target, args);
    };
  } });
}

