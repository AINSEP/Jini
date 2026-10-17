/** Metadata-only provider matching. Explicit providers take precedence over custom labels;
 * token-only compatibility is declared by the consumer, never inferred from a secret.
 * Returns matching IDs without changing inputs or performing I/O. O(providers), O(matches) space.
 */
export function matchingCredentialProviderIds({ credential, providers }: {
  credential: { kind: string; provider: string | null; label: string };
  providers: readonly { id: string; vendorId: string; acceptsCustomToken: boolean }[];
}, _options = {}): string[] {
  if (credential.kind !== "vendor" && credential.kind !== "custom") return [];
  const identity = (credential.provider ?? credential.label).toLowerCase();
  return providers.filter(provider => credential.kind === "vendor"
    ? credential.provider === provider.vendorId
    : provider.acceptsCustomToken && [provider.id, provider.vendorId].some(id => id.toLowerCase() === identity))
    .map(provider => provider.id);
}
