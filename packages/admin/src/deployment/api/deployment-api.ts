import type { AdminAuthenticatedRequestFn, AdminRequestFn } from "../../contracts/admin-request.js";
import type { AdminDeploymentOverview, AdminDockerfileSource, AdminPublishRunSnapshot, AdminPublishTargetDescriptor, AdminStaticPublishConfig, AdminStaticPublishPreview } from "./deployment-api.types.js";

/** What the host injects into {@link createDeploymentApi}. */
export interface DeploymentApiDeps {
  /** The host's authenticated admin request. */
  request: AdminRequestFn;
  /** The host's authenticated request for body, header and raw-response calls. */
  authenticatedRequest: AdminAuthenticatedRequestFn;
  /** The workspace every path is scoped under (`/workspaces/<id>/...`). */
  workspaceId: string;
}



/** The admin API calls of the deployment feature. */
export function createDeploymentApi(deps: DeploymentApiDeps, _optional: Record<string, never> = {}) {
  const { request, authenticatedRequest, workspaceId } = deps;
  return {
  // Deployment panel (the host's route /
  // `dockerfile-source.ts`) — `system.read`-gated, same shape as `getModuleStatus` just above.
  /** Runtime mode, boot-gate/default-password status, agent-daemon known-failure state, db/uploads
   *  paths, and required-env-var presence (never values) — the Deployment panel's Overview tab. */
  getDeploymentOverview: () =>
    request<AdminDeploymentOverview>({ path: `/workspaces/${workspaceId}/system/deployment-overview` }),
  /** The repo-root `Dockerfile`'s current contents, or `{ exists: false }` when none has been
   *  generated yet, plus its `etag` merged in from the response's own `ETag` header (never the JSON
   *  body — see {@link AdminDockerfileSource.etag}'s own doc). */
  getDockerfileSource: (): Promise<AdminDockerfileSource> => {
    let etag = "";
    return authenticatedRequest<{ exists: boolean; contents: string | null }>(
      { method: "GET", path: `/workspaces/${workspaceId}/system/dockerfile` },
      { onOk: ({ response }, _optional = {}) => {
        etag = response.headers.get("ETag") ?? "";
      } }
    ).then((body) => ({ ...body, etag }));
  },
  /** 2026-08-15 — `PUT` half of the Dockerfile tab, `system.write`-gated (distinct from the `GET`
   *  above's `system.read`, mirroring `triggerSiteExport`'s own `system.export` vs `system.read`
   *  split below). Overwrites the repo-root Dockerfile with `contents` and returns the snapshot it
   *  now has — this only writes bytes to disk, it never builds or deploys anything.
   *
   *  `ifMatch` (the etag from the last `getDockerfileSource`/`setDockerfileSource` response) is sent
   *  as the `If-Match` request header and REQUIRED by the server — a stale value rejects with a
   *  `412` `ApiError` whose `.body.current` carries the real `{exists, contents}` currently on disk,
   *  a missing/empty one with `400`; see {@link AdminDockerfileSource.etag}'s own doc for why. */
  setDockerfileSource: ({ contents, ifMatch }: { contents: string; ifMatch: string }, _optional: Record<string, never> = {}): Promise<AdminDockerfileSource> => {
    let etag = "";
    return authenticatedRequest<{ exists: boolean; contents: string | null }>(
      { method: "PUT", path: `/workspaces/${workspaceId}/system/dockerfile`, body: { contents } },
      { headers: { "If-Match": ifMatch }, onOk: ({ response }, _optional = {}) => {
        etag = response.headers.get("ETag") ?? "";
      } }
    ).then((body) => ({ ...body, etag }));
  },

  // Static Site tab "Getting it online" card (the host's route) —
  // publishing the current export straight to an installed static host plugin's target.
  // Same trigger+poll shape as
  // the export pair just above, plus a third pure-read preview route with no run of its own.
  /** Read-only: validates `config`, reports the base path a real publish would use (always
   *  SERVER-derived — see {@link AdminStaticPublishConfig}'s own doc), and whether a credential is
   *  configured for the target (a boolean only, never the credential itself). Never starts a run. */
  getPublishPreview: (config: AdminStaticPublishConfig) => {
    const query = new URLSearchParams({ ...config.fields, target: config.target });
    return request<AdminStaticPublishPreview>({ path: `/workspaces/${workspaceId}/system/publish/preview?${query.toString()}` });
  },
  /** The deploy targets the installed hosting plugins provide, with their publish and credential
   *  form fields — the publish card renders from this. */
  getPublishTargets: () =>
    request<{ targets: AdminPublishTargetDescriptor[] }>({ path: `/workspaces/${workspaceId}/system/publish-targets` }).then((res) => res.targets),
  /** Starts a new publish to `config.target`. `409` (surfaced as a thrown error) if one is already
   *  running — this instance runs at most one publish at a time, independent of a plain export.
   *
   *  `credentialId` names the saved connection the operator chose, and BINDS the publish to it
   *  (terra review 2026-09-20, finding 1 — Critical): without it the server resolved whichever row
   *  was `is_default` when the POST landed, so picking connection B and clicking Publish while B's
   *  promotion was still in flight published the site to A's account. The server validates the id
   *  against this workspace and this target and REFUSES on a mismatch — it never falls back to the
   *  default (`static-publish/credentials.ts`). Omitted entirely (never sent as an explicit
   *  `undefined`) when this provider has no saved connection — an install publishing from server
   *  env vars has no connection ids at all, and that caller keeps the default lookup. */
  triggerPublish: (input: { config: AdminStaticPublishConfig; projectName: string; credentialId?: string }) =>
    request<AdminPublishRunSnapshot>({ path: `/workspaces/${workspaceId}/system/publish` }, { init: {
      method: "POST",
      body: JSON.stringify({
        ...input.config.fields,
        target: input.config.target,
        projectName: input.projectName,
        ...(input.credentialId !== undefined ? { credentialId: input.credentialId } : {}),
      }),
    } }),
  /** The current/most recent publish run's status — poll this after `triggerPublish` until `status`
   *  is no longer `"running"`. */
  getPublishStatus: () => request<AdminPublishRunSnapshot>({ path: `/workspaces/${workspaceId}/system/publish` }),
  };
}
