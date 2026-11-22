/** A Node-style `error.code` as a string, or `null` when the thrown value carries none. */
export function errorCodeOf({ error }: { error: unknown }, _optional: Record<string, never> = {}): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  const { code } = error;
  return code === null || code === undefined ? null : String(code);
}

/** A human-readable message from an unknown thrown value. */
export function errorMessageOf({ error }: { error: unknown }, _optional: Record<string, never> = {}): string {
  return error instanceof Error ? error.message : String(error);
}
