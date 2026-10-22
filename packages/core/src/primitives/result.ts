/** Explicit success/failure result without exceptions or domain-specific error assumptions. */
export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };
