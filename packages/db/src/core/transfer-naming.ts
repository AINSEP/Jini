/** Host identifiers are required: changing a marker name would orphan earlier copies. */
export interface TransferNaming {
  readonly defaultSchema: string;
  readonly markerTable: string;
  readonly unvalidatedTable: string;
  readonly schemaPrefix: string;
  /** Optional SQL dollar-quote tag for compatibility with existing script consumers. */
  readonly sqlTag?: string;
}
