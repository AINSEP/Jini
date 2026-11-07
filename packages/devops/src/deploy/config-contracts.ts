/**
 * @file The deploy-config generator module contract: the one deployment descriptor every platform
 * config generator is a thin, pure function over, the options a render takes, what it returns, and
 * the kit a host passes in because a plugin module has no dependencies of its own.
 */

/** One env var a production host deployment needs set through the platform's OWN secret
 *  mechanism — a NAME only. No renderer in this module ever holds, and none may ever emit, a
 *  VALUE for any of these. */
export interface DeploymentSecret {
  readonly name: string;
  /**
   * "boot-blocking" — the production readiness gate refuses to start without a real value.
   * "recommended" — boot succeeds either way (the boot gate at most warns); without it a real
   * production feature fails closed (`503 SECRET_STORE_UNCONFIGURED`) or runs on a weaker derived
   * default until it's set. Each entry's own note in {@link REQUIRED_SECRETS}'s doc says which.
   */
  readonly requirement: "boot-blocking" | "recommended";
}

export interface DeploymentDescriptor {
  /** Default deployment name from package.json's name. Deployment callers may supply their own
   *  descriptor when the platform resource has a different name. */
  readonly appName: string;
  /** The container port the process listens on. Derived from `Dockerfile`'s `EXPOSE` line. */
  readonly port: number;
  /** Repo-relative Dockerfile path, the same root file the deployment editor owns. */
  readonly dockerfilePath: string;
  /** The one persistent volume's mount path INSIDE the container — every site's `content.db`,
   *  `uploads/`, `themes/`. Derived from Dockerfile's VOLUME declaration. A wrong
   *  value here is silent data loss on the next deploy, not a startup error. */
  readonly volumeMountPath: string;
  /** Default volume name: <package name>_sites. Callers targeting an existing volume supply its
   *  actual name in their descriptor; never rename a persisted volume by changing this default. */
  readonly volumeName: string;
  /** HTTP path the platform should poll to learn whether the host app is actually ready to serve traffic
   *  (503 until migrations/seeding finish) — not `/health`, which only proves the process is
   *  alive. Derived from the real registered route (`registerReadyzRoute`). */
  readonly healthCheckPath: string;
  /** Env vars every renderer must declare by NAME on its platform. See {@link REQUIRED_SECRETS}'s
   *  own doc for exactly how each entry here was decided. */
  readonly secrets: readonly DeploymentSecret[];
}

/** What a render function actually needs from its caller beyond the descriptor: the ONE fact that
 *  can never be derived from this repo, because it names something about the TARGET DEPLOYMENT,
 *  not about the host app itself. No renderer may default this — see each renderer's own validation. */
export interface RenderDeployConfigOptions {
  readonly region: string;
  /** Explicit non-secret runtime values (a host CLI stamps its site id). Every generator must carry
   *  them: in its environment block, or as an operator step in `notes` when the file has none. */
  readonly env?: Readonly<Record<string, string>>;
  /** Explicit non-secret image build arguments. Secret values belong in the platform secret store. */
  readonly buildArgs?: Readonly<Record<string, string>>;
}

/** One platform's generated config, plus whatever it could NOT express inside the file itself
 *  (creating a volume out of band, prompting for a secret's real value through the platform's own
 *  UI/CLI) — every generator returns this same shape so `cli/commands/deploy-config.ts` needs no
 *  per-platform branch beyond picking which generator to call. */
export interface RenderedDeployConfig {
  /** The filename this platform expects at its own conventional location (repo root). */
  readonly filename: string;
  /** The full file contents. Never contains a secret VALUE — only names, when a platform's own
   *  format has a way to declare "this key exists, prompt for it"; formats with no such field put
   *  their secrets only in `notes`. */
  readonly contents: string;
  /** Human-readable follow-up steps the file itself cannot express — volume creation, where to go
   *  set each secret's real value. Printed by the CLI, not written into any generated file. */
  readonly notes: readonly string[];
}

/** What the host passes a generator module, because a plugin module has no dependencies of its own:
 *  the shared injection guard, a constructor for the host's own `ValidationError` (so a bad
 *  `--region` surfaces exactly as it did when the generators lived in core), and the shared
 *  migrations note every generator prints. */
export interface DeployConfigKit {
  readonly assertNoConfigInjection: (fieldLabel: string, value: string) => void;
  readonly validationError: (message: string) => Error;
  readonly migrationsNote: string;
}

/** A plugin generator module's default export. `render` is pure: no I/O, throws the kit's
 *  `validationError` for a bad option. */
export interface DeployConfigGeneratorModule {
  render(descriptor: DeploymentDescriptor, options: RenderDeployConfigOptions, kit: DeployConfigKit): RenderedDeployConfig;
}
