// Type-only leaf with no imports, so credential-card-metadata.ts can share this shape without a
// lifecycle import cycle. contribution-loader.ts re-exports it on its public path.
export type PluginContributionParseResult<T> =
  | { readonly ok: true; readonly descriptors: readonly T[] }
  | { readonly ok: false; readonly reason: string };
