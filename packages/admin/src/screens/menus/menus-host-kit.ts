/**
 * @file What the host injects into the menus screen's hooks beyond each hook's port and bound
 * translator: its admin request error class (as a predicate). Nothing in this folder imports a host
 * module; the host binds one {@link MenusHostKit} at its composition root and passes it to every hook.
 */

/** The fields the menus trash classifier reads off a failed admin request. */
export interface MenusApiErrorLike extends Error {
  readonly status: number;
  readonly code?: string | undefined;
}

/** Everything the menus hooks receive from the host beyond their port and bound translator. */
export interface MenusHostKit {
  /** Whether `e` is the error class the host's admin `request` throws. The trash classifier narrows
   *  on this, so a plain `Error` with the same fields must answer `false`. */
  isApiError: (e: unknown) => e is MenusApiErrorLike;
}
