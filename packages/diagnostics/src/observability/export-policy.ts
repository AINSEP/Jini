/** Host-supplied evidence for outbound observability; independent of labels, DSNs and consent. */
export interface ObservabilityExportFacts {
  readonly forceEnable?: boolean;
  readonly development?: boolean;
  readonly packagedDesktop?: boolean;
  readonly deployedProduction?: boolean;
}

/** Decide export eligibility without I/O. A debugging override never supplies user consent.
 * @param facts Launch evidence interpreted by the host, never by a provider's saved settings.
 * @returns False for development or missing evidence; known development beats production hints.
 * @example observabilityExportAllowed({ packagedDesktop: true });
 * @complexity O(1) time and space; no effects or thrown errors for typed inputs.
 */
export function observabilityExportAllowed(facts: ObservabilityExportFacts, _options: Record<string, never> = {}): boolean {
  if (facts.forceEnable === true) return true;
  if (facts.development === true) return false;
  return facts.packagedDesktop === true || facts.deployedProduction === true;
}
