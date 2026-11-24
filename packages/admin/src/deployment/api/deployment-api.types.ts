import type { AdminPublishCredentialProviderId } from "../../security/api/security-api.types.js";

/** One required-for-production env var's presence — never its value. Mirrors
 *  `DeploymentEnvVarStatus` in the host's route. */
export interface AdminDeploymentEnvVarStatus {
  name: string;
  set: boolean;
  /** The site-key variable only: where the site key came from. There `set` means "a usable
   *  site key resolves" — a valid generated key file counts, malformed material does not. */
  source?: "env" | "file" | "none";
  /** The site-key variable only, present iff key material was found but is malformed. */
  invalid?: true;
}

/** Mirrors `DeploymentOverviewSnapshot` in the host's route
 *  — see that type's own doc comments for what each field does and does not prove. */
export interface AdminDeploymentOverview {
  mode: "production" | "local";
  productionReadinessGate: { applicable: boolean; passed: boolean };
  defaultOwnerPasswordUnsafe: boolean;
  daemonKnownFailed: boolean;
  dbPath: string;
  uploadsDir: string;
  envVars: AdminDeploymentEnvVarStatus[];
}

/** Mirrors `DockerfileSourceSnapshot` in the host's route. */
export interface AdminDockerfileSource {
  exists: boolean;
  contents: string | null;
  /**
   * A content-derived optimistic-concurrency token, read from the response's own `ETag` header —
   * NOT a field the server's JSON body carries (see the server dockerfile route's header for
   * why the etag travels only via the header). `getDockerfileSource`/`setDockerfileSource` below
   * both merge it in from the raw `Response` before resolving.
   *
   * Pass this back as `ifMatch` to `setDockerfileSource` (sent as the `If-Match` request header) to
   * prove a write is based on the CURRENT contents. A stale or missing value is refused — `412`
   * (with the real current contents in the error body to reconcile against) or `400` respectively —
   * rather than silently overwriting a concurrent edit (Terra audit finding C5, 2026-08-15: a human
   * in this admin tab and the AI assistant's `deployment_set_dockerfile` tool can both write the
   * same file).
   */
  etag: string;
}

/** A deploy target's id — whatever the server's deploy registry (the `deploy` agent plugin's
 *  descriptors) lists. Never a closed union: the admin learns the set from
 *  {@link AdminPublishTargetDescriptor}, so a host the plugin adds needs no admin change. Kept as an
 *  alias of {@link AdminPublishCredentialProviderId}: a saved credential is keyed by the same id. */
export type AdminStaticPublishTargetId = AdminPublishCredentialProviderId;

/** A plugin descriptor's translations of its own text: locale, then the English string, then its
 *  translation. Mirrors the server's `DescriptorI18n`; the host's descriptor-i18n helper applies it. */
export type AdminDescriptorI18n = Record<string, Record<string, string>>;

/** One named string field a person fills in — mirrors the server's `DeployTargetFieldSpec`. */
export interface AdminPublishTargetField {
  name: string;
  label: string;
  required?: boolean;
  /** The agent's hint; the form shows {@link userHelp} when present. */
  help?: string;
  /** The person-facing help under the input. */
  userHelp?: string;
  /** Never echoed back once saved (credential fields only). */
  secret?: true;
}

/** A host's saved-credential form as `GET .../system/publish-targets` returns it (field specs and
 *  help only, never a value). `tokenField` names the field that is the token. */
export interface AdminPublishTargetCredentialSpec {
  /** The agent's guidance; the form shows {@link userHelp} when present. */
  help?: string;
  /** The same guidance written for the person. */
  userHelp?: string;
  /** The company whose console issues and revokes the token, when it differs from the host's own
   *  label (a host named for a place, not a vendor). */
  vendorLabel?: string;
  tokenField: string;
  /** Where the person creates a token for this host. */
  tokenPageUrl?: string;
  fields: AdminPublishTargetField[];
}

/** One publish target from the deploy registry: its display label, the per-publish config fields
 *  (a repository, a team), its credential form, and the per-host label/help for the publish's
 *  `projectName` (absent: the host takes no project name, so the admin hides that field). */
export interface AdminPublishTargetDescriptor {
  id: AdminStaticPublishTargetId;
  label: string;
  configFields: AdminPublishTargetField[];
  credential?: AdminPublishTargetCredentialSpec;
  projectName?: { label: string; help?: string };
  i18n?: AdminDescriptorI18n;
}

/** A publish's target plus its descriptor-declared config values (blank optional values already
 *  dropped). The server derives `basePath` itself; there is no field here to set one. */
export interface AdminStaticPublishConfig {
  target: AdminStaticPublishTargetId;
  fields: Readonly<Record<string, string>>;
}

/** Mirrors `StaticPublishOutcome` (same file) — the terminal result of one publish attempt, present
 *  on an {@link AdminPublishRunSnapshot} once `status` is `"completed"` or `"errored"`. */
export type AdminStaticPublishOutcome =
  | { ok: true; targetId: AdminStaticPublishTargetId; url: string; status: string; deploymentId?: string; basePath?: string }
  | { ok: false; code: "INVALID_CONFIG" | "NO_CREDENTIALS_CONFIGURED" | "EXPORT_FAILED" | "PROVIDER_ERROR"; message: string };

/** Mirrors `PublishRunStatus` in the host's route. */
export type AdminPublishRunStatus = "idle" | "running" | "completed" | "errored";

/** Mirrors `PublishRunSnapshot` (same file) — the trigger+poll run slot for a publish to a
 *  static host, independent of {@link AdminExportRunSnapshot}'s own run slot (a plain export and a
 *  publish are different server-side operations with their own process-local state). */
export interface AdminPublishRunSnapshot {
  status: AdminPublishRunStatus;
  startedAtIso: string | null;
  finishedAtIso: string | null;
  target: AdminStaticPublishTargetId | null;
  /** Present only once `status` is `"completed"` or `"errored"`. */
  result?: AdminStaticPublishOutcome;
  /** Present only on the rare path where the route itself failed unexpectedly — never echoes the
   *  raw error object. */
  error?: string;
}

/** Mirrors the JSON shape `GET .../system/publish/preview` returns — see that route's own doc
 *  comment in the server publish route. A pure read: never starts a run, never echoes a credential's value,
 *  only whether one is configured. */
export interface AdminStaticPublishPreview {
  target: AdminStaticPublishTargetId;
  valid: boolean;
  validationError: string | null;
  /** `/${repo}` for a host that serves under a repository subpath, `null` for a root-served host or an invalid config — always SERVER-derived,
   *  never something the caller supplied. */
  basePath: string | null;
  credentialsConfigured: boolean;
  credentialGuidance: string | null;
  willInjectNojekyll: boolean;
}
