import { ToolInputError } from "@jini-ai/core";
import type { JsonRouteAuthorize, RouteInputContext } from "@jini-ai/core/contracts/server";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

/**
 * @file Guards shared by the saved-credential route families (custom, source-control, publish):
 * the one authorization call every verb makes first, the store-error ladder, and the `:id` + body
 * reader. Each family keeps its own permission, entity type and error classes; the host owns the
 * store and its error classes, so they arrive as injected deps and are matched by identity here.
 */

/** A host-owned error class the ladder matches with `instanceof`; the class itself never leaves the host. */
export type CredentialErrorClass = abstract new (...args: never[]) => Error;

/** One rung of a family's store-error ladder: the class and the `{ error, detail }` answer it maps to. */
export interface CredentialErrorRow { readonly type: CredentialErrorClass; readonly status: number; readonly error: string }

/** The four store errors every credential family throws; families with more add their own rows. */
export interface CredentialStoreErrorClasses {
  readonly validation: CredentialErrorClass;
  readonly duplicateLabel: CredentialErrorClass;
  readonly notFound: CredentialErrorClass;
  readonly secretStoreUnconfigured: CredentialErrorClass;
}

/** The common ladder, in the order the hand-written `sendStoreError` checked it. `extra` rows (e.g. a
 *  concurrent-modification 409) go right after validation, where that family's ladder had them.
 * @complexity O(1). */
export function credentialErrorRows(
  { classes }: { classes: CredentialStoreErrorClasses },
  { extra = [] }: { extra?: readonly CredentialErrorRow[] } = {},
): readonly CredentialErrorRow[] {
  return [
    { type: classes.validation, status: 400, error: "VALIDATION" },
    ...extra,
    { type: classes.duplicateLabel, status: 409, error: "DUPLICATE_LABEL" },
    { type: classes.notFound, status: 404, error: "NOT_FOUND" },
    { type: classes.secretStoreUnconfigured, status: 503, error: "SECRET_STORE_UNCONFIGURED" },
  ];
}

/** Answer a thrown store error from the ladder, or rethrow it unchanged for the host's redacted 500.
 *  The body is `{ error, detail }` (singular `detail`, the store's own message), so it is thrown as
 *  a raw refusal rather than through `rejectRoute`'s `{ error, code, details }` shape.
 * @complexity O(r), r = ladder rows. */
export function rejectCredentialStoreError({ err, rows }: { err: unknown; rows: readonly CredentialErrorRow[] }, _optional: Record<string, never> = {}): never {
  // A project key still used by another site is refused by the shared key store, ahead of any family class.
  if (err instanceof ToolInputError) throw new RouteRefusalError({ status: 409, body: { error: "KEY_IN_USE", detail: err.message } });
  const row = rows.find((candidate) => err instanceof candidate.type);
  if (!row) throw err;
  throw new RouteRefusalError({ status: row.status, body: { error: row.error, detail: (err as Error).message } });
}

/** Run one store step with the family ladder applied to anything it throws.
 * @complexity O(1) beyond `run`. */
export async function withCredentialStoreErrors<T>({ run, rows }: { run: () => Promise<T>; rows: readonly CredentialErrorRow[] }, _optional: Record<string, never> = {}): Promise<T> {
  try {
    return await run();
  } catch (err) {
    return rejectCredentialStoreError({ err, rows });
  }
}

/** The family's single permission check, asked before any store is reached. By-id verbs pass no
 *  `entityId`: the hand-written routes never named the credential to the authorizer.
 * @complexity O(1) beyond the host authorizer. */
export async function authorizeCredentials(
  { authorize, permission, entityType }: { authorize: JsonRouteAuthorize | undefined; permission: string; entityType: string },
  _optional: Record<string, never> = {},
): Promise<void> {
  if (!authorize) throw new Error("credential route mounted with no authorizer");
  await authorize({ permission, entityType });
}

/** A credential verb's input: the raw `:id` (as Express handed it, no fallback) and the body object. */
export interface CredentialRouteInput { readonly id: string; readonly body: Record<string, unknown> }

/** `req.params.id` and `req.body ?? {}`, exactly as the hand-written handlers read them.
 * @complexity O(1). */
export function credentialRouteInput(raw: RouteInputContext, _optional: Record<string, never> = {}): CredentialRouteInput {
  return { id: raw.params.id as string, body: (raw.body ?? {}) as Record<string, unknown> };
}

/** `body[key]` copied only when the request supplied that key: an omitted key leaves the stored
 *  value alone, while an explicit `null` (a clear) survives like any other value.
 * @complexity O(k), k = keys. */
export function presentFields(
  { body, keys }: { body: Record<string, unknown>; keys: readonly string[] },
  _optional: Record<string, never> = {},
): Record<string, unknown> {
  return Object.fromEntries(keys.filter((key) => body[key] !== undefined).map((key) => [key, body[key]]));
}
