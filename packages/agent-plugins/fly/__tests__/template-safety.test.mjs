import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Pin the portable templates themselves: host overlays can replace their own workflow regions.
// Compare every active setting so an extra secret, replica or deploy step cannot escape the pins.
// Comments and blank lines carry guidance, not configuration, and may change independently.

test("fly.toml keeps operator values as placeholders, secrets out of env and one persistent machine running", async () => {
  const template = await readFile(new URL("../skills/fly/references/fly.template.toml", import.meta.url), "utf8");
  const settings = template.split("\n").filter((line) => line.trim() && !line.trimStart().startsWith("#")).join("\n");

  assert.equal(settings, `app = "<<PLACEHOLDER: fly app name>>"
primary_region = "<<PLACEHOLDER: fly region, e.g. iad — this is NOT a default>>"
[build]
  dockerfile = "Dockerfile"
[env]
  PORT = "<<PLACEHOLDER: container port the server listens on>>"
[[mounts]]
  source = "<<PLACEHOLDER: volume name — must match \`flyctl volumes create\` exactly>>"
  destination = "<<PLACEHOLDER: volume mount path inside the container>>"
[http_service]
  internal_port = <<PLACEHOLDER: container port, the same as PORT>>
  force_https = true
  auto_stop_machines = false
  auto_start_machines = true
  min_machines_running = 1
  [[http_service.checks]]
    grace_period = "60s"
    interval = "30s"
    method = "GET"
    timeout = "5s"
    path = "<<PLACEHOLDER: readiness check path, e.g. /readyz>>"`);
});

test("the workflow keeps app and branch placeholders, serializes deploys and reads the token only from repository secrets", async () => {
  const template = await readFile(new URL("../skills/fly/references/fly-deploy.template.yml", import.meta.url), "utf8");
  const settings = template.split("\n").filter((line) => line.trim() && !line.trimStart().startsWith("#")).join("\n");

  assert.equal(settings, `name: Deploy to Fly.io
on:
  push:
    branches: [<<PLACEHOLDER: default branch, e.g. main>>]
  workflow_dispatch: {}
permissions:
  contents: read
concurrency:
  group: fly-deploy-<<PLACEHOLDER: fly app name>>
  cancel-in-progress: false
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: superfly/flyctl-actions/setup-flyctl@v1
      - run: flyctl deploy --remote-only
        env:
          FLY_API_TOKEN: \${{ secrets.FLY_API_TOKEN }}`);
});
