/**
 * @module resource-request
 *
 * Request-parsing and workspace-root helpers shared by the route packs that turn a caller's
 * `resourceRef`/`detail` into a working directory: `host-tools.ts`'s open-in route and
 * `terminals.ts`'s create route. Both previously inlined the same `detail` validation and the
 * same "resolve the root, map a {@link WorkspaceRootDeniedError} to `NOT_FOUND`, rethrow anything
 * else" block; this file is that one copy. Not re-exported from the package barrel.
 */
import { createApiError } from '@jini-ai/protocol';
import { err, ok, validationError, type Result } from '@jini-ai/http-kit';
import { resolveWorkspaceRoot, WorkspaceRootDeniedError, type WorkspaceRootResolver } from './workspace-root.js';

/** A plain JSON object body (not `null`, not an array). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Defined-only view of `T`: every key optional, and present only when its value is not `undefined`. */
export type DefinedFields<T> = { [K in keyof T]?: Exclude<T[K], undefined> };

/**
 * Copies `fields` without its `undefined`-valued keys, keeping key order — the
 * `...(x === undefined ? {} : { x })` spread pattern for many fields at once, so an absent
 * optional field is omitted from the result rather than carried as `undefined`.
 */
export function withoutUndefined<T extends Record<string, unknown>>(fields: T): DefinedFields<T> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as DefinedFields<T>;
}

/** Reads an optional body field that, when present, must be a non-empty string; refuses with `<field> must be a non-empty string when provided`. */
export function readOptionalNonEmptyString({ body, field }: { readonly body: Readonly<Record<string, unknown>>; readonly field: string }): Result<string | undefined> {
  const value = body[field];
  if (value === undefined) return ok({ value: undefined });
  if (typeof value !== 'string' || value.length === 0) {
    return err({ error: validationError({ message: `${field} must be a non-empty string when provided` }) });
  }
  return ok({ value });
}

/** Reads an optional body field that, when present, must be `typeof 'number'` (NaN/Infinity included — see the terminals pin tests); refuses with `<field> must be a number when provided`. */
export function readOptionalNumber({ body, field }: { readonly body: Readonly<Record<string, unknown>>; readonly field: string }): Result<number | undefined> {
  const value = body[field];
  if (value === undefined || typeof value === 'number') return ok({ value });
  return err({ error: validationError({ message: `${field} must be a number when provided` }) });
}

/**
 * Resolves `resourceRef`/`detail` to a working directory through `resolver`. A denial
 * ({@link WorkspaceRootDeniedError}, which the zero-config `denyAllWorkspaceRoots` default always
 * produces) becomes a generic `NOT_FOUND`; any other resolver failure is rethrown unchanged so the
 * transport's internal-error path handles it rather than disguising it as a missing resource.
 */
export async function resolveResourceRoot(
  { resourceRef, detail }: { readonly resourceRef: string; readonly detail?: string | undefined },
  { resolver }: { readonly resolver: WorkspaceRootResolver },
): Promise<Result<string>> {
  try {
    return ok({ value: await resolveWorkspaceRoot({ request: { resourceRef, ...withoutUndefined({ detail }) } }, { resolver }) });
  } catch (error) {
    if (error instanceof WorkspaceRootDeniedError) {
      return err({ error: createApiError({ code: 'NOT_FOUND', message: `resource "${resourceRef}" was not found` }) });
    }
    throw error;
  }
}
