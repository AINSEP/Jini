/** Shared pieces of the People and Roles error-copy mappers (`describePeopleError`, `describeRolesError`). */

/** The string `code` of a structured error, or undefined when there is none. */
export function errorCode({ error }: { error: unknown }, _optional: Record<string, never> = {}): string | undefined {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
}

/** A real Error's non-empty message, else the given fallback copy. */
export function errorMessageOr({ error, fallback }: { error: unknown; fallback: string }, _optional: Record<string, never> = {}): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
