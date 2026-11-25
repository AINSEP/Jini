type Empty = Record<string, never>;

export interface BundledProviderRefusalCopy {
  readonly sourceFailure: string;
  readonly packageFailure: (required: { pluginId: string }) => string;
  readonly duplicateId: (required: { id: string }) => string;
}

export async function collectBundledSourceControlProviders<Source extends { pluginId: string }, Provider>(
  required: {
    sources: () => readonly Source[];
    load: (required: { source: Source }) => Promise<{ providers: readonly Provider[]; refusals: readonly string[] }>;
    providerId: (required: { provider: Provider }) => string;
    reportSourceFailure: (required: { error: unknown }) => void;
    copy: BundledProviderRefusalCopy;
  },
  _optional: Empty = {},
): Promise<{ providers: readonly Provider[]; refusals: readonly string[] }> {
  let sources: readonly Source[];
  try { sources = required.sources(); }
  catch (error) {
    required.reportSourceFailure({ error });
    return { providers: [], refusals: [required.copy.sourceFailure] };
  }
  const providers = new Map<string, Provider>();
  const duplicates = new Set<string>();
  const refusals: string[] = [];
  for (const plugin of sources) {
    let registry: { providers: readonly Provider[]; refusals: readonly string[] };
    try { registry = await required.load({ source: plugin }); }
    catch {
      // Import/read errors can contain paths or credentials; report only the product-owned id.
      refusals.push(required.copy.packageFailure({ pluginId: plugin.pluginId }));
      continue;
    }
    refusals.push(...registry.refusals);
    for (const provider of registry.providers) {
      const id = required.providerId({ provider });
      if (providers.has(id)) duplicates.add(id);
      providers.set(id, provider);
    }
  }
  for (const id of duplicates) {
    providers.delete(id);
    refusals.push(required.copy.duplicateId({ id }));
  }
  return { providers: [...providers.values()], refusals };
}
