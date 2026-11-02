/**
 * @file The Railway deploy-config generator: renders `railway.json` from the host's
 * `DeploymentDescriptor`. Pure: no I/O; the host passes the kit and appends its own notes after render.
 * Schema verified via context7 against Railway's own current docs (`/railwayapp/docs`), fetched
 * 2026-08-31, not written from memory:
 * - `build.builder: "DOCKERFILE"` + `build.dockerfilePath` and `deploy.healthcheckPath` /
 *   `deploy.restartPolicyType: "ON_FAILURE"` are confirmed real config-as-code fields (the Rails and
 *   Jupyter deploy guides' own worked `railway.json` examples).
 * - Railway's config-as-code has NO env-var / secrets section at all (variables are managed only via
 *   the Dashboard, the CLI (`railway variables set`), or the GraphQL API). Emitting an invented
 *   `envVars`/`variables` key would just be ignored or misread, so this renderer emits none, and
 *   every secret appears in `notes` instead.
 * - Railway's config-as-code has NO volume field either (the docs' own reference snippet is captioned
 *   "railway.toml format (no volume mount support)"). The volume-creation step appears in `notes`,
 *   via the plain CLI command the docs show (`railway volume add --mount-path <path>`).
 * - No plain single-service `region` field exists in `railway.json`/`railway.toml`, only
 *   `deploy.multiRegionConfig`, a map of region to replica count. Pinning to exactly one region is a
 *   single-entry map with `numReplicas: 1`: a server whose state lives on one volume must run as
 *   exactly one replica.
 *
 * Plain JS by owner decision (2026-09-29). Built through `JSON.stringify`, so it needs no injection
 * guard.
 */

/**
 * @typedef {{ readonly name: string, readonly requirement: "boot-blocking" | "recommended" }} DeploymentSecret
 * @typedef {{ readonly appName: string, readonly port: number, readonly dockerfilePath: string, readonly volumeMountPath: string, readonly volumeName: string, readonly healthCheckPath: string, readonly secrets: readonly DeploymentSecret[] }} DeploymentDescriptor
 * @typedef {{ readonly region: string, readonly env?: Readonly<Record<string, string>> }} RenderDeployConfigOptions
 * @typedef {{ readonly assertNoConfigInjection: (fieldLabel: string, value: string) => void, readonly validationError: (message: string) => Error, readonly migrationsNote: string }} DeployConfigKit
 * @typedef {{ readonly filename: string, readonly contents: string, readonly notes: readonly string[] }} RenderedDeployConfig
 */

/**
 * Railway's 4 selectable region identifiers (service settings, apply identically to
 * `multiRegionConfig` keys). Source: context7 `/railwayapp/docs`, "Deployment regions table",
 * fetched 2026-08-31.
 */
export const RAILWAY_VALID_REGIONS = Object.freeze(["us-west2", "us-east4-eqdc4a", "europe-west4-drams3a", "asia-southeast1-eqsg3a"]);

/**
 * railway.json cannot hold variables, so each explicit non-secret one the host passes in `options.env`
 * becomes a `railway variables set` step, single-quoted for the shell.
 * @param {{ env: Readonly<Record<string, string>>, secrets: readonly DeploymentSecret[] }} input
 * @param {DeployConfigKit} kit
 * @returns {string[]}
 * @throws {Error} For an invalid name, a non-string value or a declared secret name; never echoes the value.
 * @complexity O(n + s) for n variable characters and s declared secrets.
 */
function envNotes({ env, secrets }, kit) {
  const secretNames = new Set(secrets.map((secret) => secret.name));
  return Object.entries(env).map(([name, value]) => {
    if (!/^[A-Za-z_]\w*$/.test(name) || typeof value !== "string" || secretNames.has(name)) {
      throw kit.validationError("env must contain only non-secret string variables with valid names");
    }
    return `Set ${name} with: railway variables set ${name}='${value.replace(/'/g, "'\\''")}' — railway.json has no env-var section.`;
  });
}

/**
 * @param {DeploymentDescriptor} descriptor
 * @param {RenderDeployConfigOptions} options
 * @param {DeployConfigKit} kit
 * @returns {RenderedDeployConfig}
 */
function render(descriptor, options, kit) {
  const region = options.region.trim();
  if (!region) {
    throw kit.validationError("--region is required for --target railway (no default region is assumed)");
  }
  if (!RAILWAY_VALID_REGIONS.includes(region)) {
    throw kit.validationError(`--region "${region}" is not a valid Railway region — one of: ${RAILWAY_VALID_REGIONS.join(", ")}`);
  }

  const variableNotes = envNotes({ env: options.env ?? {}, secrets: descriptor.secrets }, kit);
  const config = {
    $schema: "https://railway.com/railway.schema.json",
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: descriptor.dockerfilePath,
    },
    deploy: {
      healthcheckPath: descriptor.healthCheckPath,
      restartPolicyType: "ON_FAILURE",
      multiRegionConfig: {
        [region]: { numReplicas: 1 },
      },
    },
  };

  const contents = `${JSON.stringify(config, null, 2)}\n`;

  const notes = [
    `Create the volume once, before the first deploy — railway.json has no field for this (Railway's ` +
      `config-as-code does not support declaring volumes): railway volume add --mount-path ${descriptor.volumeMountPath} ` +
      `(name it "${descriptor.volumeName}" to match the host's other platform configs).`,
    kit.migrationsNote,
    ...descriptor.secrets.map(
      (secret) =>
        `Set ${secret.name} (${secret.requirement}) with: railway variables set ${secret.name}=<value> — railway.json has no ` +
        "env-var section; Railway manages variables outside config-as-code."
    ),
    ...variableNotes,
  ];

  return { filename: "railway.json", contents, notes };
}

export default { render };
