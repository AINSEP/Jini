/** Mirrors `apps/website/src/server/inbound/admin-http/http/redirects.ts`'s `AdminRedirectDto` (SPEC-009). */
export interface AdminRedirect {
  id: string;
  workspaceId: string;
  matchType: string;
  fromPattern: string;
  toTarget: string;
  statusCode: number;
  status: string;
  override: boolean;
  priority: number;
  source: string;
  sourceEntryId: string | null;
  fromPathAtCapture: string | null;
  toPathAtCapture: string | null;
  createdByPrincipal: string;
  createdByPluginId: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface AdminRedirectHitStats {
  redirectId: string;
  workspaceId: string;
  hitCount: number;
  lastHitAt: string | null;
}

/** One rule item accepted by `POST .../redirects/import` — mirrors `CreateRedirectInput`'s public
 * fields (`workspaceId`/`actorId` are injected server-side from the session, not sent). */
export interface RedirectImportRule {
  matchType: string;
  fromPattern: string;
  toTarget: string;
  statusCode: number;
  override?: boolean;
  priority?: number;
}

/** Mirrors `toAdminRedirectImportResponse`'s shape (`apps/website/src/server/inbound/admin-http/http/redirects.ts`) — the route
 * always answers `207 Multi-Status`, so this is a plain success body, not an error path. */
export interface AdminRedirectImportResponse {
  created: AdminRedirect[];
  failed: Array<{ index: number; code: string; message: string }>;
}
