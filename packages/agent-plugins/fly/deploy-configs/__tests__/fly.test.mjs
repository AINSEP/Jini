import assert from "node:assert/strict";
import test from "node:test";

import generator from "../fly.mjs";

// The fly.toml generator against a fake host kit. Moved from Tovu
// (content/agent-plugins/fly/deploy-configs/__tests__/fly.test.mjs); the production-workflow parity
// case stays with Tovu's overlay, which owns that workflow.

class FakeValidationError extends Error {}

const kit = {
  assertNoConfigInjection: (label, value) => {
    if (/["\r\n]/.test(value)) throw new FakeValidationError(`unsafe ${label}`);
  },
  validationError: (message) => new FakeValidationError(message),
  migrationsNote: "HOST MIGRATIONS NOTE",
};

const DESCRIPTOR = {
  appName: "acme-app",
  port: 4000,
  dockerfilePath: "Dockerfile",
  volumeMountPath: "/srv/data",
  volumeName: "acme_data",
  healthCheckPath: "/readyz",
  secrets: [{ name: "ADMIN_PASSWORD", requirement: "boot-blocking" }],
};

const render = (options, descriptor = DESCRIPTOR) => generator.render(descriptor, options, kit);

test("exact fly.toml for a known descriptor: PORT from the descriptor, no host runtime switch defaulted", () => {
  const result = render({ region: "iad" });
  assert.equal(result.filename, "fly.toml");
  assert.equal(result.contents, `app = "acme-app"
primary_region = "iad"

[build]
  dockerfile = "Dockerfile"

[env]
  PORT = "4000"

[[mounts]]
  source = "acme_data"
  destination = "/srv/data"

[http_service]
  internal_port = 4000
  force_https = true
  auto_stop_machines = false
  auto_start_machines = true
  min_machines_running = 1

  [[http_service.checks]]
    grace_period = "60s"
    interval = "30s"
    method = "GET"
    timeout = "5s"
    path = "/readyz"
`);
});

test("the host's env and build args are serialized after the descriptor's PORT; env may override PORT", () => {
  const { contents } = render({ region: "iad", env: { APP_MODE: "production", PORT: "8080" }, buildArgs: { INSTALL_EXTRA: "1" } });
  assert.ok(contents.includes(`[build.args]\n  INSTALL_EXTRA = "1"\n\n[env]\n  PORT = "8080"\n  APP_MODE = "production"\n`));
});

test("values are escaped TOML strings, including DEL", () => {
  const { contents } = render({ region: "iad", env: { URL: 'a"b\\c\n\u007f' } });
  assert.ok(contents.includes(String.raw`  URL = "a\"b\\c\n\u007f"` + "\n"));
});

test("invalid names, non-strings and declared secrets are refused in either map", () => {
  for (const options of [{ env: { "A-B": "x" } }, { env: { A: 1 } }, { buildArgs: { ADMIN_PASSWORD: "v" } }]) {
    assert.throws(() => render({ region: "iad", ...options }), FakeValidationError);
  }
});

test("notes: create the volume, the host's migrations note, each secret by name; nothing host-specific", () => {
  const { notes } = render({ region: "iad" });
  assert.deepEqual(notes, [
    "Create the volume before the first deploy — this file only MOUNTS it, it does not create it: fly volumes create acme_data --region iad -a acme-app",
    "HOST MIGRATIONS NOTE",
    "Set ADMIN_PASSWORD (boot-blocking) with: fly secrets set ADMIN_PASSWORD=<value> -a acme-app",
  ]);
});

test("rejects a missing region, and every quoted sink goes through the host's guard (TOML injection regression)", () => {
  assert.throws(() => render({ region: " " }), /--region is required/);
  assert.throws(() => render({ region: 'iad"\nprimary_region_evil="x' }), /unsafe --region/);
  assert.throws(() => render({ region: "iad" }, { ...DESCRIPTOR, appName: 'a"b' }), /unsafe the derived Fly app name/);
  assert.throws(() => render({ region: "iad" }, { ...DESCRIPTOR, volumeName: "v\n" }), /unsafe the derived Fly volume name/);
});
