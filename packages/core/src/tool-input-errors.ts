/** @file Dependency-free tool input errors shared by registration and normalization. */

/**
 * Thrown by a `ToolHandler` (or a validator it calls, e.g. the kernel's `registration-kit.ts`
 * `requireString`/`requireInputRecord`/etc.) to mean "the caller's input was malformed or missing a
 * required field" — a fact about the CALL, not the server. `@jini-ai/daemon`'s `ToolExecutor.execute`
 * tags a handler rejection's `ToolExecutionResult.errorKind` as `'validation'` when the thrown error
 * is `instanceof ToolInputError`, and every HTTP-facing mapping of a `'failed'` execution (today:
 * `@jini-ai/http-kit`'s `delegated-tools.ts`) uses that tag to answer with a 4xx instead of folding
 * it into the same redacted 500 an actual internal/infrastructure failure gets.
 *
 * Deliberately a plain marker with no extra fields: the message itself is already caller-actionable
 * (`withSchemaOnRejection` appends the tool's own input schema to it), so nothing beyond "this IS one
 * of these" needs to survive the `instanceof` check.
 */
export class ToolInputError extends Error {
  constructor({ message }: { message: string }, optional: ErrorOptions = {}) {
    super(message, optional);
    this.name = 'ToolInputError';
  }
}

/** Keeps caller shape failures distinct from infrastructure/policy failures in the gate. */
export class ToolInputNormalizationError extends ToolInputError {}
