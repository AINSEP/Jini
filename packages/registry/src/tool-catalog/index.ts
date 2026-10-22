/** Searchable tool descriptors; no SQL, driver, or content-registry coupling. */
export interface ToolCatalogEntry {
  readonly id: string;
  readonly description: string;
  /** JSON-Schema-shaped, `unknown` for the same reason `@jini-ai/core`'s `ToolDescriptor.inputSchema` is — this table never parses or validates it. */
  readonly inputSchema?: unknown;
  /** `first-party | plugin | unverified` — carried into what a model sees, per `PROP` §7.1. Every entry seeded from an in-tree `ToolRegistry` today is `first-party`. */
  readonly source: string;
}

export interface ToolCatalogSearchHit {
  readonly id: string;
  readonly description: string;
  readonly source: string;
  readonly score: number;
}

/** Structural search/describe seam for HTTP or assistant composition. */
export interface ToolCatalogQuery {
  search(required: { query: string }, optional?: { limit?: number }): readonly ToolCatalogSearchHit[];
  describe(required: { id: string }): ToolCatalogEntry | null;
}
