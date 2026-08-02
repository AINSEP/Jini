/**
 * @file The transport seam — the single primitive every admin route group is built on.
 *
 * ## Why this exists
 *
 * Tovu's `apps/admin/src/lib/api.ts` is 1,548 lines and 134 methods in one flat object literal,
 * every one of them closing over a module-private `request()` and a module-private
 * `BASE = "/api/admin/v1"`. That shape has two costs: the whole object is one unit (you cannot
 * take the 67 generic methods without the 67 CMS-domain ones), and there is no way for a host to
 * add a route group without editing the file.
 *
 * Inverting it — `request` becomes an injected `AdminTransport`, and each route group becomes a
 * factory over it — makes both work:
 *
 * ```ts
 * const transport = createHttpTransport({ baseUrl: '/api/admin/v1' });
 *
 * const client = createAdminClient(transport, {
 *   identity: createIdentityRoutes,          // shipped by @jini-ai/admin
 *   media:    createMediaRoutes,             // shipped by @jini-ai/admin
 *   posts:    createTovuPostRoutes,          // Tovu's own, same signature
 *   widgets:  createTovuWidgetRoutes,        // Tovu's own
 * });
 *
 * await client.identity.listUsers();   // Jini's
 * await client.posts.list();           // Tovu's
 * ```
 *
 * Both halves share one auth policy, one error class, one place to add retries or tracing. A host
 * adding a route is a factory plus one line in the map — it never edits a Jini file, and it never
 * grows a second `fetch` wrapper with its own subtly different error handling, which is exactly
 * how `api.ts` reached 1,548 lines.
 *
 * ## Why `AdminTransport` is an interface and not just a function
 *
 * A bare `request<T>(path, init)` function would have been enough for HTTP. It is an interface so
 * a host can supply a non-HTTP implementation without any route group knowing: Tovu-Runner drives
 * many site instances in-process and can hand over a direct-dispatch transport that never opens a
 * socket, and tests can supply a fake that returns fixtures. Both are the same seam, which is the
 * point.
 */

/**
 * How an admin route group talks to its backend.
 *
 * Implementations must throw `AdminApiError` on a non-success response so panels can rely on one
 * error shape regardless of which transport is wired. A transport that throws its own error type
 * silently breaks every panel's `instanceof` check.
 */
export interface AdminTransport {
  /**
   * @param path Route-group-relative path, always starting with `/` (`/users`, `/media/abc`).
   *   The base is the transport's concern — a route group that embeds a base is not portable to
   *   a host that mounts the admin API somewhere else.
   * @param init Standard `RequestInit`. A transport that is not HTTP-backed may ignore fields it
   *   cannot honour, but must respect `method` and `body`.
   * @throws {AdminApiError} on any non-success response.
   */
  request<T>(path: string, init?: RequestInit): Promise<T>;
}

/**
 * A route group: turns a transport into a typed set of operations.
 *
 * Every port implementation in this package is one of these, and a host's own route groups use
 * the identical signature — that symmetry is what lets Jini-shipped and host-owned groups sit in
 * the same client with no adapter between them.
 */
export type AdminRouteGroupFactory<TPort> = (transport: AdminTransport) => TPort;

/**
 * The assembled client: one object carrying every wired route group.
 *
 * `TGroups` is inferred from the factory map handed to `createAdminClient`, so a host's own
 * groups are as type-safe as the shipped ones with no declaration merging or module augmentation.
 */
export type AdminClient<TGroups extends Record<string, AdminRouteGroupFactory<unknown>>> = {
  readonly [K in keyof TGroups]: ReturnType<TGroups[K]>;
} & {
  /** The transport every group was built over — exposed so a host can make one-off calls to a
   *  route it has not (or will never) wrap in a group, without reaching for a bare `fetch`. */
  readonly transport: AdminTransport;
};
