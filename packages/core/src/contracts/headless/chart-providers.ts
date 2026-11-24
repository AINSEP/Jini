/** Serializable admin bootstrap; declarations and execution remain owned by Jini's chart ABI. */
export interface AdminChartProviderSnapshot {
  readonly generation: string;
  readonly siteProvider: string;
  readonly providers: readonly { id: string; kinds: readonly string[]; javascript: string; stylesheet?: string }[];
}
