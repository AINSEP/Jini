import type { AdminFormDefinition } from "./forms-api.types.js";

/** The host's authenticated admin request — it owns the base URL, authentication, retries and
 *  error decoding, so this client only names the method, path and body. */
export type FormsRequestFn = <T>(required: { method: string; path: string; body?: unknown }) => Promise<T>;

/** What the host injects: its authenticated request and the workspace every path is scoped to. */
export interface CreateFormsApiArgs { request: FormsRequestFn; workspaceId: string }

/** The admin API calls of the forms feature, bound to the host's injected `request`.
 *  @example const formsApi = createFormsApi({ request, workspaceId }); */
export function createFormsApi({ request, workspaceId }: CreateFormsApiArgs, _optional: Record<string, never> = {}) {
  return {
    // SPEC-010 Forms (Tier-1 sample plugin) — admin UI.
    listForms: () => request<{ data: AdminFormDefinition[] }>({ method: "GET", path: `/workspaces/${workspaceId}/forms` }),
  };
}
