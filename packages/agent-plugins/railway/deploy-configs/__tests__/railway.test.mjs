import assert from "node:assert/strict";
import test from "node:test";

import generator, { RAILWAY_VALID_REGIONS } from "../railway.mjs";

// The railway.json generator against a fake host kit. Moved from Tovu
// (content/agent-plugins/railway/deploy-configs/__tests__/railway.test.mjs); the cases that drive
// Tovu's CLI or pack through Tovu's lifecycle stay with Tovu's overlay tests.

class FakeValidationError extends Error {}

const kit = {
  assertNoConfigInjection: () => {
    throw new Error("railway.json is built with JSON.stringify and never needs the injection guard");
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

const render = (options) => generator.render(DESCRIPTOR, options, kit);

test("exact railway.json for a known descriptor and region, with no env-var section", () => {
  const result = render({ region: "us-west2" });
  assert.equal(result.filename, "railway.json");
  assert.equal(result.contents, `${JSON.stringify({
    $schema: "https://railway.com/railway.schema.json",
    build: { builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    deploy: { healthcheckPath: "/readyz", restartPolicyType: "ON_FAILURE", multiRegionConfig: { "us-west2": { numReplicas: 1 } } },
  }, null, 2)}\n`);
});

test("notes: the volume step, the host's migrations note and each secret by name, and nothing host-specific", () => {
  const { notes } = render({ region: "us-west2" });
  assert.equal(notes.length, 3);
  assert.match(notes[0], /railway volume add --mount-path \/srv\/data \(name it "acme_data" to match the host's other platform configs\)/);
  assert.equal(notes[1], "HOST MIGRATIONS NOTE");
  assert.match(notes[2], /^Set ADMIN_PASSWORD \(boot-blocking\) with: railway variables set ADMIN_PASSWORD=<value>/);
  assert.doesNotMatch(notes.join("\n"), /TOVU|Tovu|Chromium/);
});

test("each options.env variable becomes a shell-quoted railway variables set step", () => {
  const { notes, contents } = render({ region: "us-west2", env: { SITE_ID: "it's" } });
  assert.equal(notes.at(-1), "Set SITE_ID with: railway variables set SITE_ID='it'\\''s' — railway.json has no env-var section.");
  assert.doesNotMatch(contents, /SITE_ID/);
});

test("values with newlines or control characters are refused: a single-quoted shell argument cannot carry them safely", () => {
  for (const value of ["first\nsecond\u0000", "nul\u0000byte", "cr\rx", "tab\tx", "esc\u001bx", "del\u007fx", "c1\u0085x"]) {
    assert.throws(
      () => render({ region: "us-west2", env: { SITE_ID: value } }),
      (error) => error instanceof FakeValidationError && /SITE_ID/.test(error.message) && /control character/.test(error.message) && !error.message.includes(value)
    );
  }
});

test("invalid names, non-strings and declared secrets are refused without echoing the value", () => {
  for (const env of [{ "A-B": "x" }, { A: 1 }, { ADMIN_PASSWORD: "secret-value" }]) {
    assert.throws(() => render({ region: "us-west2", env }), (error) => error instanceof FakeValidationError && !error.message.includes("secret-value"));
  }
});

test("rejects a missing or unknown region; every documented region pins exactly one replica", () => {
  assert.throws(() => render({ region: "" }), /--region is required/);
  assert.throws(() => render({ region: "iad" }), /not a valid Railway region/);
  for (const region of RAILWAY_VALID_REGIONS) {
    assert.deepEqual(JSON.parse(render({ region }).contents).deploy.multiRegionConfig, { [region]: { numReplicas: 1 } });
  }
});
