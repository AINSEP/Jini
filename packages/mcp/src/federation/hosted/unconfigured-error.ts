/** Raised when sealing fails because no site key is configured — distinct from a validation error,
 *  because nothing the operator types can fix it. */
/** @agent-note The ONE canonical "no site key" error class, thrown by the store when sealing cannot run; hosts map it by `instanceof` (plugin `classifyError` → `unconfigured`). Never rebuild it elsewhere. */
export class ExternalMcpSecretStoreUnconfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExternalMcpSecretStoreUnconfiguredError";
  }
}
