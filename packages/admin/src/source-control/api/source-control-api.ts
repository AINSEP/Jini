import type { AdminRequestFn } from "../../contracts/admin-request.js";
import type { AdminSourceControlConnectionInput, AdminSourceControlCredentialsSnapshot, AdminSourceControlCredentialSummary, AdminSourceControlProvidersSnapshot } from "./source-control-api.types.js";

/** What the host injects into {@link createSourceControlApi}. */
export interface SourceControlApiDeps {
  /** The host's authenticated admin request. */
  request: AdminRequestFn;
  /** The workspace every path is scoped under (`/workspaces/<id>/...`). */
  workspaceId: string;
}



/** The admin API calls of the source-control feature. */
export function createSourceControlApi(deps: SourceControlApiDeps, _optional: Record<string, never> = {}) {
  const { request, workspaceId } = deps;
  return {
  // Source Control page → credential management (the host's route) — one saved GitHub/GitLab/Bitbucket identity connection per
  // provider, stored encrypted server-side and never read back. Structurally mirrors the
  // publish-credentials block above; see `AdminSourceControlCredentialSummary`'s own doc for
  // exactly what a saved row can and cannot reveal. `source-control.credentials.write`-gated on
  // every verb server-side — NOT the same permission as the publish-credentials calls above (see
  // that route's own header for why connecting a source-control identity is not a publish
  // trigger).
  /** The source-control hosts switched-on plugins declare, with their credential forms. */
  listSourceControlProviders: () => request<AdminSourceControlProvidersSnapshot>({ path: `/workspaces/${workspaceId}/system/source-control/providers` }),
  /** Every configured source-control credential for this workspace. */
  listSourceControlCredentials: () =>
    request<AdminSourceControlCredentialsSnapshot>({ path: `/workspaces/${workspaceId}/system/source-control/credentials` }),
  /** Creates one named connection. `409 DUPLICATE_LABEL` (surfaced as a thrown `ApiError` with that
   *  `code`) if this workspace already has a credential with the same `(providerId, label)`.
   *  `isDefault` is optional — omitted entirely (not `false`) lets the server apply its own
   *  default-assignment rule (a provider's first-ever saved connection), rather than this admin
   *  guessing at it. */
  createSourceControlCredential: (input: { label: string; connection: AdminSourceControlConnectionInput; isDefault?: boolean }) =>
    request<{ credential: AdminSourceControlCredentialSummary }>({ path: `/workspaces/${workspaceId}/system/source-control/credentials` }, { init: {
      method: "POST",
      body: JSON.stringify(input),
    } }),
  /** Updates a credential's label, connection, and/or default status. Omitting `connection`
   *  entirely — never sending it as an empty object or blank fields — is what keeps the stored
   *  secret untouched; see the host's source-control credentials hook header for why the form can
   *  never send a half-blank one. */
  updateSourceControlCredential: ({ id, input }: { id: string; input: { label?: string; connection?: AdminSourceControlConnectionInput; isDefault?: boolean } }, _optional: Record<string, never> = {}) =>
    request<{ credential: AdminSourceControlCredentialSummary }>({ path: `/workspaces/${workspaceId}/system/source-control/credentials/${encodeURIComponent(id)}` }, { init: {
      method: "PUT",
      body: JSON.stringify(input),
    } }),
  /** `204`, idempotent — deleting an id that is already gone (a stale list, a double click) still
   *  resolves rather than throwing. Not called anywhere on this page today (there is no delete
   *  affordance in the UI — replacing a token PUTs over the existing row), kept for parity with
   *  the publish-credentials block above. */
  deleteSourceControlCredential: ({ id }: { id: string }, _optional: Record<string, never> = {}) =>
    request<void>({ path: `/workspaces/${workspaceId}/system/source-control/credentials/${encodeURIComponent(id)}` }, { init: { method: "DELETE" } }),
  };
}
