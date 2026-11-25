import type { CredentialTokenHint } from "@jini-ai/core/contracts/site/secrets-credential-token";
import type { AdminDescriptorI18n, AdminPublishTargetField } from "../../deployment/api/deployment-api.types.js";

/**
 * A source-control host's id. The hosts come from plugins (`GET .../system/source-control/providers`),
 * so this is any string; a saved connection may name a host whose plugin is now off. Deliberately its
 * own type, NOT {@link AdminPublishCredentialProviderId}: a source host is not a publish target.
 */
export type AdminSourceControlProviderId = string;

/** A source-control host's credential form as a plugin declares it: field specs and help only.
 *  `tokenField` names the secret field that is the token. */
export interface AdminSourceControlCredentialForm {
  help?: string;
  tokenPageUrl?: string;
  tokenField: string;
  fields: AdminPublishTargetField[];
}

/** One listed source-control host. No `credential` means a single "Access token" field. */
export interface AdminSourceControlProviderDescriptor {
  id: AdminSourceControlProviderId;
  label: string;
  credential?: AdminSourceControlCredentialForm;
  i18n?: AdminDescriptorI18n;
}

/** Mirrors `GET .../system/source-control/providers`: the hosts switched-on plugins declare, and
 *  each host an installed but switched-off plugin declares. */
export interface AdminSourceControlProvidersSnapshot {
  providers: AdminSourceControlProviderDescriptor[];
  switchedOff: { id: AdminSourceControlProviderId; pluginId: string }[];
  /** Why an installed plugin's hosts were not loaded (one sentence each, naming the plugin), so an
   *  empty list can say why instead of showing nothing. */
  refusals: string[];
}

/**
 * One saved connection's non-secret summary — never carries the token itself, and (like
 * {@link AdminPublishCredentialSummary}) deliberately carries no masked/last-4 hint either. A
 * stored token is never read back once saved; this is the fact a row's UI has to render its
 * connected/not-connected state from.
 */
export interface AdminSourceControlCredentialSummary {
  readonly tokenHint?: CredentialTokenHint | null;
  readonly id: string;
  readonly providerId: AdminSourceControlProviderId;
  readonly label: string;
  readonly configured: true;
  readonly isDefault: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** What a create/update call sends: the host id, the token, and the host's other declared
 *  credential fields by name. */
export type AdminSourceControlConnectionInput = { providerId: AdminSourceControlProviderId; token: string } & Record<string, string>;

/** Mirrors `GET .../system/source-control/credentials`'s response shape. No `executionMode` field
 *  here — unlike static publish, this page has no CLI-vs-hosted distinction to disclose. */
export interface AdminSourceControlCredentialsSnapshot {
  // Mutable array, not `readonly` — `useSourceControlCredentials` seeds local `useState` from this
  // field directly, and a `readonly` array there is not assignable to that mutable state without a
  // cast (same reasoning `AdminPublishCredentialsSnapshot.credentials` follows implicitly by also
  // being mutable).
  credentials: AdminSourceControlCredentialSummary[];
}
