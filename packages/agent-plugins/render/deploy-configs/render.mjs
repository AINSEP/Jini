/**
 * @file The Render deploy-config generator: renders `render.yaml` (a Render Blueprint) from the
 * host's `DeploymentDescriptor`. Pure: no I/O; the host passes the kit (`assertNoConfigInjection`,
 * `validationError(message)`, `migrationsNote`). Schema verified via context7 against Render's own
 * current docs (`/websites/render`, "Blueprint Specification" + `llms-full.txt`'s example
 * `render.yaml`), fetched 2026-08-31, not written from memory:
 * - A Dockerfile-built `type: web` service uses `runtime: docker`; with no `rootDir` given, the build
 *   looks for `Dockerfile` at the repo root by default, so no `dockerfilePath`-shaped override field
 *   is emitted.
 * - `region` is a fixed enum (see {@link RENDER_VALID_REGIONS}), "cannot be modified after service
 *   creation", which is exactly why this renderer refuses to guess or default it.
 * - `envVars[].sync: false` is Render's mechanism for "this key exists, prompt for its value in the
 *   Dashboard". No value ever appears next to it here.
 * - `disk` (name/mountPath/sizeGB) is valid on `type: web` for paid services, which is why
 *   `plan: starter` is set explicitly: the free tier does not support persistent disks at all.
 * - Every web service must bind `0.0.0.0:$PORT`, defaulting to 10000 if unset, so `PORT` is declared
 *   from the descriptor's container port.
 *
 * Host-specific runtime switches and follow-up notes are the host's input: it passes non-secret
 * variables in `options.env` and appends its own notes after render. This module defaults none.
 */

/**
 * @typedef {{ readonly name: string, readonly requirement: "boot-blocking" | "recommended" }} DeploymentSecret
 * @typedef {{ readonly appName: string, readonly port: number, readonly dockerfilePath: string, readonly volumeMountPath: string, readonly volumeName: string, readonly healthCheckPath: string, readonly secrets: readonly DeploymentSecret[] }} DeploymentDescriptor
 * @typedef {{ readonly region: string, readonly env?: Readonly<Record<string, string>> }} RenderDeployConfigOptions
 * @typedef {{ readonly assertNoConfigInjection: (fieldLabel: string, value: string) => void, readonly validationError: (message: string) => Error, readonly migrationsNote: string }} DeployConfigKit
 * @typedef {{ readonly filename: string, readonly contents: string, readonly notes: readonly string[] }} RenderedDeployConfig
 */

/**
 * Render's Blueprint `region` enum. Source: context7 `/websites/render`, "Blueprint Specification >
 * region": "The region field specifies where a service is deployed, with options including oregon,
 * ohio, virginia, frankfurt, and singapore. This value cannot be modified after service creation."
 * Fetched 2026-08-31.
 */
export const RENDER_VALID_REGIONS = Object.freeze(["oregon", "ohio", "virginia", "frankfurt", "singapore"]);

/**
 * Quotes a value as a YAML double-quoted scalar. JSON string escapes are valid YAML escapes; YAML
 * additionally forbids raw DEL, C1 controls and U+FFFE/U+FFFF, so those are escaped too.
 * @param {string} value
 * @returns {string}
 * @complexity O(n) in the value length.
 */
function yamlString(value) {
  return JSON.stringify(value).replace(/[\u007f-\u009f\ufffe\uffff]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/** Upper-case environment variable names only (plan v2 §5.1). */
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;

/**
 * Checks the explicit non-secret variables the host passes in `options.env`. Values are strings
 * with no line break: a Blueprint value is one quoted scalar, and a multi-line secret-shaped value
 * belongs in the platform's secret store instead.
 * @param {{ env: Readonly<Record<string, string>>, secrets: readonly DeploymentSecret[] }} input
 * @param {DeployConfigKit} kit
 * @returns {[string, string][]}
 * @throws {Error} For an invalid name, a non-string or multi-line value, or a declared secret name; never
 *   echoes the value.
 * @complexity O(n + s) for n variables and s declared secrets.
 */
function checkedEnv({ env, secrets }, kit) {
  const secretNames = new Set(secrets.map((secret) => secret.name));
  const entries = Object.entries(env);
  for (const [name, value] of entries) {
    if (!ENV_NAME.test(name) || typeof value !== "string" || /[\r\n]/.test(value) || secretNames.has(name)) {
      throw kit.validationError("env must contain only non-secret single-line string variables with upper-case names");
    }
  }
  return entries;
}

/**
 * `PORT` comes from the descriptor unless `options.env` overrides it; explicit entries follow, then
 * each declared secret as `sync: false`.
 * @param {DeploymentDescriptor} descriptor
 * @param {Readonly<Record<string, string>>} env
 * @param {DeployConfigKit} kit
 * @returns {string}
 * @complexity O(n + s) for n variables and s declared secrets.
 */
function renderEnvVarsBlock(descriptor, env, kit) {
  const explicit = checkedEnv({ env, secrets: descriptor.secrets }, kit);
  const lines = [];
  if (!("PORT" in env)) lines.push("      - key: PORT", `        value: "${descriptor.port}"`);
  for (const [name, value] of explicit) lines.push(`      - key: ${name}`, `        value: ${yamlString(value)}`);
  for (const secret of descriptor.secrets) {
    lines.push(`      - key: ${secret.name}`, "        sync: false");
  }
  return lines.join("\n");
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
    throw kit.validationError("--region is required for --target render (no default region is assumed)");
  }
  if (!RENDER_VALID_REGIONS.includes(region)) {
    throw kit.validationError(`--region "${region}" is not a valid Render region — one of: ${RENDER_VALID_REGIONS.join(", ")}`);
  }
  // `region` itself needs no separate injection check here: it just passed the allow-list above, so
  // it can only be one of RENDER_VALID_REGIONS's five known-safe literals.
  kit.assertNoConfigInjection("the derived Render service name", descriptor.appName);
  kit.assertNoConfigInjection("the derived Render disk name", descriptor.volumeName);

  const contents = `services:
  - type: web
    name: ${descriptor.appName}
    runtime: docker
    plan: starter
    region: ${region}
    healthCheckPath: ${descriptor.healthCheckPath}
    envVars:
${renderEnvVarsBlock(descriptor, options.env ?? {}, kit)}
    disk:
      name: ${descriptor.volumeName}
      mountPath: ${descriptor.volumeMountPath}
      sizeGB: 10
`;

  const notes = [
    "Persistent disks require a paid plan — \"plan: starter\" above is the cheapest tier that supports " +
      "one; the free tier cannot attach this disk at all.",
    "Render prompts for each `sync: false` env var's real value in the Dashboard the first time this " +
      "Blueprint is applied — no value is stored in this file.",
    kit.migrationsNote,
    ...descriptor.secrets.map((secret) => `${secret.name} is ${secret.requirement} — set its value in the Render Dashboard.`),
  ];

  return { filename: "render.yaml", contents, notes };
}

export default { render };
