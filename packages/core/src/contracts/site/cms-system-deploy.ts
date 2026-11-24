/**
 * @file The admin deployment-overview wire DTOs: the JSON body `GET .../system/deployment-overview`
 * answers and an admin client reads. Declared here, once, so the server spec
 * (`@jini-ai/cms/admin-http/routes/system/deployment-overview`) and any client mirror read the same
 * shape without the client depending on CMS. The owner-password rule stays in CMS and every
 * process-state read stays in the host; only the declarations sit in Core.
 */

/** One required-for-production env var's presence, never its value. */
export interface DeploymentEnvVarStatus {
  name: string;
  set: boolean;
  /** site key row only: where the keyring's material came from. */
  source?: string;
  /** site key row only, present iff material was found but the keyring would reject it. */
  invalid?: true;
}

/** The Overview tab's wire body; the host builds every field but `defaultOwnerPasswordUnsafe`'s input. */
export interface DeploymentOverviewSnapshot {
  /** The host's own two-value runtime mode, echoed in its exact vocabulary rather than translated. */
  mode: 'production' | 'local';
  /** In production a failing readiness gate exits before listening, so reaching this route proves it passed;
   *  `applicable: false` in local mode is the honest "this check does not run here" state, not a hidden pass. */
  productionReadinessGate: { applicable: boolean; passed: boolean };
  /** Whether the owner's STORED hash still verifies against the default password.
   *  Computed unconditionally (not gated on production mode) since it is a real, useful warning in local mode too. */
  defaultOwnerPasswordUnsafe: boolean;
  /** A negative signal only: "not known-failed" can also mean "never spawned", never "confirmed alive". */
  daemonKnownFailed: boolean;
  dbPath: string;
  uploadsDir: string;
  /** Presence only, per required env var — never a value. */
  envVars: DeploymentEnvVarStatus[];
}
