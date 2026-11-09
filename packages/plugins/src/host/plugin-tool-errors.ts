/** Canonical installer refusal shared by portable tools and filesystem adapters. */
export class PluginInstallError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "PluginInstallError"; }
}
/** Canonical source refusal shared by portable tools and filesystem adapters. */
export class PluginSourceError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'PluginSourceError'; }
}
