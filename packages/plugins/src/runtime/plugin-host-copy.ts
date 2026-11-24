/**
 * @file The product copy a host passes into the plugin runtime's model-facing text (tool catalogs,
 * set-enabled/uninstall/install messages). Type-only: the engine names no product, no package
 * format and no environment variable of its own in text a model reads, so the host supplies them.
 */

/** Host product copy for plugin tool catalogs and messages. */
export interface PluginHostCopy {
  /** The product name the model is told about, e.g. in "restart <productName>". */
  readonly productName: string;
  /** The site-plugin package format the model is told about, e.g. ".acme-plugin". */
  readonly sitePluginFormat: string;
  /** The environment variable that turns local plugin installs on for a hosted server. */
  readonly localInstallEnv: string;
  /** The host tool the model calls to list site plugins (the catalogs and messages point the model at it). */
  readonly pluginListToolName: string;
}
