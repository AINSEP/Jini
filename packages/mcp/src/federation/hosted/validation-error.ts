/** Raised when operator-supplied input cannot be stored. Carries `field` so a route can point the
 *  form at the offending input rather than rejecting the whole submission opaquely. */
/** @agent-note The ONE canonical validation error class: hosts and seams recognize it by `instanceof` (plugin `classifyError` → `validation`, sign-in refusal). Never subclass-copy or rebuild it elsewhere; `name` and `field` are part of its identity. */
export class ExternalMcpValidationError extends Error {
  readonly field: string;

  constructor(
    message: string,
    field: string,
  ) {
    super(message);
    this.field = field;
    this.name = "ExternalMcpValidationError";
  }
}
