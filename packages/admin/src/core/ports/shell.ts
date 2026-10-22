import type { AdminAuthUser } from './auth.js';

/** Host-owned API scope. No site, tenant or workspace-id vocabulary is imposed. */
export interface AdminShellContext {
  readonly apiBase: string;
  readonly workspace: Readonly<Record<string, string>>;
}

/** Session identity plus UI affordances; servers must authorize every operation themselves. */
export interface AdminShellSession {
  readonly user: AdminAuthUser;
  readonly effectivePermissions?: readonly string[];
}

/** Adapters return null for a missing session and reject for infrastructure failures. */
export interface AdminShellSessionPort {
  read(args: AdminShellContext): Promise<AdminShellSession | null>;
  logout(args: AdminShellContext): Promise<void>;
  /** Emit only genuine session invalidation, never an upstream provider's authentication error. */
  onUnauthenticated(args: AdminShellContext & { readonly onUnauthenticated: () => void }): () => void;
}

/** Route snapshots include the query string but exclude the fragment and admin base. */
export interface AdminShellNavigationPort {
  readRoute(args: { readonly base: string }): string;
  subscribe(args: { readonly base: string; readonly onChange: () => void }): () => void;
  navigate(args: { readonly base: string; readonly routePath: string }, options?: { readonly replace?: boolean }): void;
  /** Hosts with a framework router can supply their own anchor interception adapter. */
  installLinkInterceptor(args: { readonly base: string }): () => void;
}
