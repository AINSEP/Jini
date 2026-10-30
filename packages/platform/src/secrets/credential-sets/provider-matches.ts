import { VaultError, type VaultOptions } from "./vault.types.js";

/** Host-supplied catalog identity and accepted payload shape; catalogs never live in the vault. */
export interface CredentialProviderDescriptor {
  id: string;
  vendorId: string;
  acceptsCustomToken: boolean;
}
/** Safe metadata needed for matching. Labels and provider groups never imply compatibility. */
export interface MatchableCredential {
  kind: string;
  provider: string | null;
  meta: { credentialType?: unknown; worksFor?: unknown };
}

/** Validate and canonicalize explicit compatibility IDs without consulting a catalog.
 * @throws VaultError for non-array, non-string, empty or whitespace-bearing IDs.
 * @complexity O(total ID characters) time and space; does not mutate the supplied array.
 * @example normalizeCredentialWorksFor({ value: ["GitHub", "github"] }); // ["github"]
 */
export function normalizeCredentialWorksFor({ value }: { value: unknown }, _options: VaultOptions = {}): string[] {
  if (!Array.isArray(value)) throw new VaultError({ code: "invalid-meta" });
  const ids = new Set<string>();
  for (const id of value) {
    if (typeof id !== "string" || !id || /\s/.test(id)) throw new VaultError({ code: "invalid-meta" });
    ids.add(id.toLowerCase());
  }
  return [...ids];
}

/** Return compatible host IDs from saved metadata, respecting the consumer's payload shape.
 * Historical custom-kind rows use the same parsed metadata until migration. Unknown kinds and
 * malformed metadata are ineligible. Performs no inference or I/O.
 * @complexity O(worksFor + providers) time, O(worksFor + matches) space.
 * @example matchingCredentialProviderIds({ credential, providers });
 */
export function matchingCredentialProviderIds({ credential, providers }: {
  credential: MatchableCredential;
  providers: readonly CredentialProviderDescriptor[];
}, _options: VaultOptions = {}): string[] {
  const { credentialType, worksFor } = credential.meta;
  if (!hasMatchableType({ kind: credential.kind, credentialType }) ||
    !Array.isArray(worksFor) || !Array.from(worksFor).every(isCanonicalProviderId)) return [];
  const ids = new Set(worksFor);
  return providers.filter(provider => (credentialType !== "custom" || provider.acceptsCustomToken) &&
    (ids.has(provider.id.toLowerCase()) || ids.has(provider.vendorId.toLowerCase())))
    .map(provider => provider.id);
}

/** vendor/custom rows only; a custom-kind row must also carry the custom subtype. */
function hasMatchableType({ kind, credentialType }: { kind: string; credentialType: unknown }): boolean {
  if (kind !== "vendor" && kind !== "custom") return false;
  if (kind === "custom" && credentialType !== "custom") return false;
  return credentialType === "vendor" || credentialType === "custom";
}

/** A non-empty, already-lowercased ID without whitespace, as {@link normalizeCredentialWorksFor} stores it. */
function isCanonicalProviderId(id: unknown): boolean {
  return typeof id === "string" && id !== "" && id === id.toLowerCase() && !/\s/.test(id);
}

/** Select an eligible explicit ID, the descriptor's provider-group default, or a sole candidate.
 * Missing IDs and unresolved ambiguity return null; custom-group defaults do not rank candidates.
 * @complexity O(credentials * average worksFor) time, O(credentials) candidate space.
 * @example selectCredentialForProvider({ credentials, provider, id: selectedId });
 */
export function selectCredentialForProvider<T extends MatchableCredential & { id: string; isDefault: boolean }>({
  credentials, provider, id,
}: { credentials: readonly T[]; provider: CredentialProviderDescriptor; id?: string }, _options: VaultOptions = {}): T | null {
  const candidates = credentials.filter(credential => matchingCredentialProviderIds({ credential, providers: [provider] }).length > 0);
  if (id !== undefined) return candidates.find(credential => credential.id === id) ?? null;
  const defaults = candidates.filter(credential => credential.provider === provider.vendorId && credential.isDefault);
  if (defaults.length === 1) return defaults[0]!;
  return candidates.length === 1 ? candidates[0]! : null;
}

/** Suggest one explicit ID for create-time prefill only, using an injected catalog.
 * Matches exact spelling ignoring case; whitespace/substrings are never normalized. A spelling
 * shared by conflicting vendor groups is ambiguous, while repeated hosts in one group are safe.
 * @complexity O(providers) time, O(matching vendor groups) space; no mutation or I/O.
 * @example suggestCredentialWorksFor({ label: "GitHub", providers }); // ["github"]
 */
export function suggestCredentialWorksFor({ label, providers }: {
  label: string;
  providers: readonly { id: string; vendorId: string }[];
}, _options: VaultOptions = {}): string[] {
  const identity = label.toLowerCase();
  const vendors = new Set(providers.filter(provider => provider.id.toLowerCase() === identity ||
    provider.vendorId.toLowerCase() === identity).map(provider => provider.vendorId.toLowerCase()));
  return identity && vendors.size === 1 ? [identity] : [];
}
