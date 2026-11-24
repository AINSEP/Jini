import type { AdminHttp } from "./admin-http/request.js";
import type { AdminHttpError } from "@jini-ai/core/admin-runtime";

/** Mirrors `VisitorToolsView` in `@jini-ai/core/contracts/site/site-assistant-visitor-tools-management`.
 * The admin page and the assistant chat's `visitor_tools_list` read the same service, so this shape
 * is the server's, field for field. `policyState: "invalid"` means the saved policy is unreadable and
 * every tool is effectively Off until the site-wide Off repair succeeds. */
export type VisitorToolMode = "auto" | "ask" | "off";
export interface VisitorToolLimits { perIpPerHour: number; perSitePerDay: number }
export interface VisitorToolView {
  id: string;
  source: "builtin" | "plugin" | "created" | "unavailable";
  sourceRevision: string;
  title: string;
  description: string;
  displayTitle?: string;
  displayDescription?: string;
  effect: "read" | "write";
  availability: { available: boolean; reason?: string };
  publication?: { endpoint: string; credentialId: string; returnedFields: string[] };
  mode: VisitorToolMode;
  limits: VisitorToolLimits;
}
export interface VisitorToolsView {
  revisionSeq: number;
  policyState?: "invalid";
  defaults: VisitorToolLimits;
  callsPerTurn: number;
  tools: VisitorToolView[];
}
/** `toolId: "site"` patches every available tool at once (the invalid-policy repair uses it). */
export interface VisitorToolConfigureInput {
  toolId: string;
  expectedRevisionSeq: number;
  mode?: VisitorToolMode;
  limits?: Partial<VisitorToolLimits>;
}
export interface VisitorToolsPort {
  list(required: Record<string, never>, optional?: Record<string, never>): Promise<VisitorToolsView>;
  configure(required: VisitorToolConfigureInput, optional?: Record<string, never>): Promise<VisitorToolsView>;
}

/** HTTP 409 code: someone else saved first; reload, never auto-retry. */
export const VISITOR_TOOLS_CONFLICT_CODE = "VISITOR_TOOLS_REVISION_CONFLICT";
/** Settings-ledger namespace the policy is stored under; the shared settings feed names it on change. */
export const VISITOR_TOOLS_NAMESPACE = "site.assistant";

/** The one host request operation the port sends through: its authenticated admin request. */
export type AdminRequestOps = Pick<AdminHttp<AdminHttpError, string, string>, "authenticatedAdminRequest">;

/**
 * Thin host adapter over the shared authenticated request (session, error and reconnect boundary).
 * The host injects its bound request operations and its workspace id; a host binds once.
 *
 * @complexity Time/space: O(1) to build; each call is one request.
 */
export function createVisitorToolsPort(
  { http, workspaceId }: { http: AdminRequestOps; workspaceId: string },
  _optional: Record<string, never> = {},
): VisitorToolsPort {
  const path = `/workspaces/${workspaceId}/assistant/visitor-tools`;
  return {
    list: async () => (await http.authenticatedAdminRequest<{ data: VisitorToolsView }>({ path, method: "GET" })).data,
    configure: async (body, _optional = {}) => (await http.authenticatedAdminRequest<{ data: VisitorToolsView }>({ path, method: "PUT", body })).data,
  };
}
