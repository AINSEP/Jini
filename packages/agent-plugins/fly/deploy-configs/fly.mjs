/**
 * @file The Fly deploy-config generator: renders `fly.toml` from the host's `DeploymentDescriptor`
 * (`[build]`, `[env]`, `[[mounts]]`, `[http_service]` with a check on the descriptor's health path).
 * A host's CI can import this dependency-free module directly (the workflow template's generate
 * step); there is no checked-in `fly.toml` to read. Host-specific runtime switches arrive in
 * `options.env` and host notes are appended by the host after render: this module defaults none.
 *
 * No enumerated region allow-list here, unlike the Render/Railway renderers: Fly's region catalog is
 * large (~30 codes) and had no authoritative source to enumerate against without risking rejecting a
 * real one. Only presence is checked.
 *
 * Every quoted sink (`app = "${...}"`, `source = "${...}"`, `primary_region = "${...}"`) goes through
 * the host kit's `assertNoConfigInjection` first: `--region 'iad"\nprimary_region_evil="x'` once closed
 * the quoted value early and emitted a real extra `primary_region_evil` key into `fly.toml` (moved
 * here from the host's kit doc; regression pinned in `__tests__/fly.test.mjs`).
 *
 * Plain JS by owner decision (2026-09-29). The host passes the kit: `assertNoConfigInjection`,
 * `validationError(message)`, `migrationsNote`.
 */

/**
 * @typedef {{ readonly name: string, readonly requirement: "boot-blocking" | "recommended" }} DeploymentSecret
 * @typedef {{ readonly appName: string, readonly port: number, readonly dockerfilePath: string, readonly volumeMountPath: string, readonly volumeName: string, readonly healthCheckPath: string, readonly secrets: readonly DeploymentSecret[] }} DeploymentDescriptor
 * @typedef {{ readonly region: string, readonly env?: Readonly<Record<string, string>>, readonly buildArgs?: Readonly<Record<string, string>> }} RenderDeployConfigOptions
 * @typedef {{ readonly assertNoConfigInjection: (fieldLabel: string, value: string) => void, readonly validationError: (message: string) => Error, readonly migrationsNote: string }} DeployConfigKit
 * @typedef {{ readonly filename: string, readonly contents: string, readonly notes: readonly string[] }} RenderedDeployConfig
 */

/**
 * Serializes explicitly supplied non-secret variables as TOML assignments. JSON string quoting
 * also escapes TOML basic strings, including URLs, backslashes, quotes and control characters.
 * @param {{ values: Readonly<Record<string, string>>, secrets: readonly DeploymentSecret[], label: string }} input
 * @param {DeployConfigKit} kit Error factory supplied by the host.
 * @returns {string} Indented assignments, or an empty string for an empty map.
 * @throws {Error} For invalid variable names, non-string values or declared secret names.
 * @complexity O(n + s), where n is the total variable text and s the secret count.
 */
function renderVariables({ values, secrets, label }, kit) {
  const secretNames = new Set(secrets.map(secret => secret.name));
  return Object.entries(values).map(([name, value]) => {
    if (!/^[A-Za-z_]\w*$/.test(name) || typeof value !== "string" || secretNames.has(name)) {
      throw kit.validationError(`${label} must contain only non-secret string variables with valid names`);
    }
    // JSON permits a literal DEL character; TOML requires it to be escaped too.
    return `  ${name} = ${JSON.stringify(value).replace(/\u007f/g, "\\u007f")}\n`;
  }).join("");
}

/**
 * Renders the descriptor and optional non-secret env/build arguments without I/O. The established
 * three-argument generator port is retained for compatibility with every hosting plugin.
 * @param {DeploymentDescriptor} descriptor
 * @param {RenderDeployConfigOptions} options
 * @param {DeployConfigKit} kit
 * @returns {RenderedDeployConfig}
 * @throws {Error} The host's validation error for missing/unsafe identifiers or invalid variables.
 * @complexity O(n + s), where n is variable text and s the declared secret count.
 */
function render(descriptor, options, kit) {
  const region = options.region.trim();
  if (!region) {
    throw kit.validationError("--region is required for --target fly (no default region is assumed)");
  }
  kit.assertNoConfigInjection("--region", region);
  kit.assertNoConfigInjection("the derived Fly app name (fly.toml's app)", descriptor.appName);
  kit.assertNoConfigInjection("the derived Fly volume name (fly.toml's [[mounts]].source)", descriptor.volumeName);

  const buildArgs = renderVariables({ values: options.buildArgs ?? {}, secrets: descriptor.secrets, label: "buildArgs" }, kit);
  const env = renderVariables({
    values: { PORT: String(descriptor.port), ...options.env },
    secrets: descriptor.secrets,
    label: "env",
  }, kit);

  const contents = `app = "${descriptor.appName}"
primary_region = "${region}"

[build]
  dockerfile = "${descriptor.dockerfilePath}"

${buildArgs ? `[build.args]\n${buildArgs}\n` : ""}[env]
${env.trimEnd()}

[[mounts]]
  source = "${descriptor.volumeName}"
  destination = "${descriptor.volumeMountPath}"

[http_service]
  internal_port = ${descriptor.port}
  force_https = true
  auto_stop_machines = false
  auto_start_machines = true
  min_machines_running = 1

  [[http_service.checks]]
    grace_period = "60s"
    interval = "30s"
    method = "GET"
    timeout = "5s"
    path = "${descriptor.healthCheckPath}"
`;

  const notes = [
    `Create the volume before the first deploy — this file only MOUNTS it, it does not create it: ` +
      `fly volumes create ${descriptor.volumeName} --region ${region} -a ${descriptor.appName}`,
    kit.migrationsNote,
    ...descriptor.secrets.map(
      (secret) => `Set ${secret.name} (${secret.requirement}) with: fly secrets set ${secret.name}=<value> -a ${descriptor.appName}`
    ),
  ];

  return { filename: "fly.toml", contents, notes };
}

export default { render };
