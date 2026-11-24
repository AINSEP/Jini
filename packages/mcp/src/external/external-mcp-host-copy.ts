/**
 * @file The product copy a host passes into the external MCP domain's model-facing text (the setup
 * and operations tool catalogs, and the operations handlers' refusal messages). Type-only: the
 * engine names neither the host's settings screen nor the host's own read tool in text a model
 * reads, so the host supplies them.
 */

/** Host product copy for external MCP tool catalogs and messages. */
export interface ExternalMcpHostCopy {
  /** Where the host's admin form for external MCP servers lives, as the model is told, e.g. "Settings → External MCP". */
  readonly settingsLocation: string;
  /** The host tool the model calls to read configured servers (the catalogs and messages point the model at it). */
  readonly listToolName: string;
}
