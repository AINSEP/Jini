/** Manifest-owned opt-in contracts shared by source guards and staged-package checks. */
export interface OptionalPeerManifest {
  name?: string;
  dependencies?: Readonly<Record<string, string>>;
  peerDependencies?: Readonly<Record<string, string>>;
  peerDependenciesMeta?: Readonly<Record<string, { optional?: boolean }>>;
  jini?: { optionalPeers?: Readonly<Record<string, string>> };
}
function isOptionalPeer({ manifest, name }: { manifest: OptionalPeerManifest; name: string }): boolean {
  return Boolean(manifest.peerDependencies?.[name] && manifest.peerDependenciesMeta?.[name]?.optional === true);
}
/** Only an explicit feature and actionable message authorize an optional runtime boundary. */
export function optionalPeerClassification(
  { manifest, name }: { manifest: OptionalPeerManifest; name: string },
  _options: Record<string, never> = {},
): string | undefined {
  const value = manifest.jini?.optionalPeers?.[name];
  if (!isOptionalPeer({ manifest, name })) return undefined;
  return typeof value === 'string' && /^opt-in: \S.* [—–] \S.+/.test(value) ? value : undefined;
}

/** Classification is mandatory even when an optional peer happens to be installed locally. */
export function optionalPeerContractProblems(
  { manifest }: { manifest: OptionalPeerManifest }, _options: Record<string, never> = {},
): string[] {
  return Object.entries(manifest.peerDependenciesMeta ?? {}).filter(([name, meta]) =>
    meta.optional === true && !optionalPeerClassification({ manifest, name }))
    .map(([name]) => `unclassified optional peer ${name}; declare jini.optionalPeers with opt-in feature and user-facing message, or make it required`);
}
