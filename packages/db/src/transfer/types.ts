export interface TransferColumn {
  readonly name: string;
  readonly sqlType: string;
  readonly notNull: boolean;
  /** A Postgres default expression, already SQL. */
  readonly default?: string;
  /** Postgres identity kind; the copy writes the source's numbers, then moves the counter past them. */
  readonly identity?: "ALWAYS" | "BY DEFAULT";
}

export interface TransferIndex {
  readonly name: string;
  readonly columns: readonly string[];
  readonly unique: boolean;
}

export interface TransferForeignKey {
  readonly name: string;
  readonly columns: readonly string[];
  readonly foreignTable: string;
  /** `null` = the parent's primary key (a SQLite foreign key may leave its columns out). */
  readonly foreignColumns: readonly string[] | null;
  readonly onDelete: string;
  readonly onUpdate: string;
}

export interface TransferCheck {
  readonly name: string;
  readonly sql: string;
}

export interface TransferTable {
  readonly name: string;
  readonly columns: readonly TransferColumn[];
  readonly primaryKey: readonly string[];
  /** A source-side predicate selecting the rows that are copied; absent = every row. */
  readonly keep?: string;
  readonly indexes: readonly TransferIndex[];
  readonly foreignKeys: readonly TransferForeignKey[];
  readonly checks: readonly TransferCheck[];
}


/** Host identifiers are required: changing a marker name would orphan earlier copies. */
export interface TransferNaming {
  readonly defaultSchema: string;
  readonly markerTable: string;
  readonly unvalidatedTable: string;
  readonly schemaPrefix: string;
  /** Optional SQL dollar-quote tag for compatibility with existing script consumers. */
  readonly sqlTag?: string;
}
