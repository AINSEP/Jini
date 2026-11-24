/** The host's authenticated admin request — it owns the base URL, authentication, retries, error
 *  decoding and failure publishing, so this client only names paths, methods and bodies. */
export type ProvidersRequestFn = <T>(required: { path: string }, optional?: { init?: RequestInit }) => Promise<T>;

/** What the host injects into {@link createProvidersApi}. */
export interface ProvidersApiDeps {
  /** The host's authenticated admin request. */
  request: ProvidersRequestFn;
  /** The workspace every providers path is scoped under (`/workspaces/<id>/project-keys/...`). */
  workspaceId: string;
}

/** What `useProjectKey` resolves to: whether this site now uses the key, who else does, and when the
 *  change takes effect. */
export interface ProjectKeyUseResult {
  keyId: string;
  usedByThisSite: boolean;
  usedBy: string[];
  appliesAt: "now" | "restart" | "failed";
  message?: string;
}

/** The admin API calls of the providers feature, bound to the host's injected collaborators.
 *  @example const providersApi = createProvidersApi({ request, workspaceId }); */
export function createProvidersApi(deps: ProvidersApiDeps, _optional: Record<string, never> = {}) {
  const { request, workspaceId } = deps;
  return {
    useProjectKey: ({ keyId, use }: { keyId: string; use: boolean }, _optional = {}) =>
      request<ProjectKeyUseResult>({ path: `/workspaces/${workspaceId}/project-keys/${encodeURIComponent(keyId)}/use` }, { init: { method: "PUT", body: JSON.stringify({ use }) } }),
  };
}
