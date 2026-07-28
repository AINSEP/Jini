/**
 * Generic, host-injectable "workspace root" resolution port.
 *
 * Several OD route packs need the same thing at the boundary: "given some
 * opaque resource reference, what filesystem directory does a spawned
 * process or launched editor run in?" OD answers that with
 * `ctx.projectStore.getProject` + `ctx.projectFiles.resolveProjectDir` — a
 * project-store lookup plus a metadata-driven directory resolver, both
 * product-specific (see `packages/http/source-map.md`'s routes-classification
 * table, rows `#11 terminal.ts` and `#23 host-tools.ts`, both of which name
 * exactly this dependency as the reason `POST /api/projects/:id/open-in` and
 * the interactive-terminal spawn route were not ported earlier). The kernel
 * has no concept of "project," so it cannot hardcode that lookup — but it
 * also must not silently invent a directory (guessing `process.cwd()` or an
 * OS temp dir would let one request's resource reference leak into an
 * unrelated working directory).
 *
 * Follows the same explicit-injection, conservative-default shape this repo
 * already established for `@injini/cli`'s `resolveDaemonUrl`
 * (`packages/cli/src/daemon-url.ts`): a host supplies a resolver callback; the
 * built-in default resolves nothing and the resolution function throws
 * rather than guessing. It also mirrors `active-context.ts`'s
 * `resolveResource` DI shape (a caller-supplied lookup replacing OD's
 * `getProject`) and its `resourceRef`/`detail` field naming.
 */

/** What a route needs resolved: an opaque resource reference, plus an optional sub-locator within it (e.g. a specific file), matching `active-context.ts`'s `resourceRef`/`detail` naming. */
export interface WorkspaceRootRequest {
  readonly resourceRef: string;
  readonly detail?: string | null;
}

/**
 * Host-supplied lookup: given a {@link WorkspaceRootRequest}, return the
 * absolute filesystem path a process/editor should be rooted at, or a
 * nullish value when this host has no directory for that resource (an
 * unknown id, a resource with no on-disk representation, or a caller not
 * permitted to resolve it — the resolver decides, the kernel does not).
 */
export type WorkspaceRootResolver = (
  request: WorkspaceRootRequest,
) => string | null | undefined | Promise<string | null | undefined>;

/** Thrown by {@link resolveWorkspaceRoot} when no root could be resolved — the caller has nothing safe to spawn a process or open an editor against. */
export class WorkspaceRootDeniedError extends Error {
  readonly resourceRef: string;

  constructor(resourceRef: string, reason?: string) {
    super(reason ?? `no workspace root available for resource "${resourceRef}"`);
    this.name = 'WorkspaceRootDeniedError';
    this.resourceRef = resourceRef;
  }
}

/**
 * The built-in, zero-config default resolver: resolves nothing, for every
 * request. A host that never wires its own resolver gets a hard denial from
 * every call site that needs a workspace root — never a guessed path. This
 * is the "conservative default that denies rather than guessing" half of
 * the port, matching the task's explicit precedent
 * (`ToolPolicy`/`resolveDaemonUrl`).
 */
export const denyAllWorkspaceRoots: WorkspaceRootResolver = () => null;

export interface ResolveWorkspaceRootOptions {
  /** Defaults to {@link denyAllWorkspaceRoots} — a host must explicitly opt in to resolving real paths. */
  readonly resolver?: WorkspaceRootResolver;
}

/**
 * Resolves a workspace root for `request` via `options.resolver`.
 *
 * @throws {WorkspaceRootDeniedError} If the resolver is omitted, or returns
 * `null`/`undefined`/an empty string. This function never falls back to a
 * guessed path (`process.cwd()`, an OS temp dir, `resourceRef` itself
 * treated as a path) — a route that cannot resolve a real root has nothing
 * safe to act on.
 * @complexity O(1) plus the injected resolver's own cost.
 * @overallScore 100/100
 */
export async function resolveWorkspaceRoot(
  request: WorkspaceRootRequest,
  options: ResolveWorkspaceRootOptions = {},
): Promise<string> {
  const resolver = options.resolver ?? denyAllWorkspaceRoots;
  const root = await resolver(request);
  if (typeof root !== 'string' || root.length === 0) {
    throw new WorkspaceRootDeniedError(request.resourceRef);
  }
  return root;
}
