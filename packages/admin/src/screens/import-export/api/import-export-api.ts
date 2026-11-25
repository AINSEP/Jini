import type { AdminExportRunSnapshot } from "../../../core/index.js";

/** What the host injects into {@link createImportExportApi}. */
export interface ImportExportApiDeps {
  /** The host's `request`: it owns the base URL, authentication, retries and error decoding, so this client only names paths, methods and bodies. */
  request: <T>(required: { path: string }, optional?: { init?: RequestInit }) => Promise<T>;
  /** The workspace the paths are scoped under (`/workspaces/<id>/...`). */
  workspaceId: string;
}

/** The admin API calls of the import-export feature, bound to the host's injected collaborators.
 *  @example const importExportApi = createImportExportApi({ request, workspaceId }); */
export function createImportExportApi({ request, workspaceId }: ImportExportApiDeps, _optional: Record<string, never> = {}) {
  return {
    // Static Site tab (the host's system export route) — trigger + poll, not a
    // single synchronous call: a real export can take seconds to minutes, so `triggerSiteExport`
    // returns the moment the run STARTS (202) and a caller polls `getSiteExportStatus` for the
    // outcome. `system.export`-gated on trigger (writes to disk), `system.read` on the poll.
    /** Starts a new static-site export. `409` (surfaced as a thrown error by `request`, same as any
     *  non-2xx) if one is already running — this instance runs at most one export at a time. */
    triggerSiteExport: (options?: { clean?: boolean; basePath?: string }) =>
      request<AdminExportRunSnapshot>({ path: `/workspaces/${workspaceId}/system/export` }, { init: {
        method: "POST",
        body: JSON.stringify(options ?? {}),
      } }),
    /** The current/most recent export run's status — poll this after `triggerSiteExport` until
     *  `status` is no longer `"running"`. */
    getSiteExportStatus: () => request<AdminExportRunSnapshot>({ path: `/workspaces/${workspaceId}/system/export` }),
  };
}
