import { orFallback } from '@jini-ai/core/errors/idioms';
/** Credential tools over required host operations, vocabulary and card ports. */
export { createCredentialSaveHandlers, createCredentialToolRegistrations } from "./tool-registrations.js";
export { createCredentialCopyRegistrations } from "./credential-copy-tool.js";
export type { CredentialCopyRequired } from "./credential-copy-tool.js";
export type * from "./credential-tool-host.js";
export type * from "./credential-tool-operations.js";

/** Optional plugin catalogs enrich this feature's create form without owning its save path. */
export async function loadCreateCredentialProviders({ routeDeps }: { routeDeps: { workspaceId: string;
  loadDeployTargets?: (input: { workspaceId: string }) => Promise<{ list(): readonly { descriptor: { id: string; credential?: { vendorId: string } } }[] }>;
  loadSourceControlProviders(input: { workspaceId: string }): Promise<{ list(): readonly { descriptor: { id: string } }[] }>;
} }, _options = {}): Promise<{ id: string; vendorId: string }[]> {
  const providers: { id: string; vendorId: string }[] = [];
  // Catalogs enrich a create-time prefill only. An unavailable plugin must not prevent saving
  // an API key or erase explicitly supplied compatibility IDs.
  await orFallback({ work: async () => { for (const { descriptor } of (await routeDeps.loadDeployTargets?.({ workspaceId: routeDeps.workspaceId }))?.list() ?? []) {
    if (descriptor.credential) providers.push({ id: descriptor.id, vendorId: descriptor.credential.vendorId });
  } }, fallback: undefined, step: 'Read hosting credential choices' }); /* The API key form still works without hosting plugins. */
  await orFallback({ work: async () => { for (const { descriptor } of (await routeDeps.loadSourceControlProviders({ workspaceId: routeDeps.workspaceId })).list()) {
    providers.push({ id: descriptor.id, vendorId: descriptor.id });
  } }, fallback: undefined, step: 'Read source-control credential choices' }); /* Source-control catalog enrichment is optional too. */
  return providers;
}

