import assert from "node:assert/strict";
import test from "node:test";

import generator, { RENDER_VALID_REGIONS } from "../render.mjs";

// The render.yaml generator against a fake host kit. Exact-string assertions pin the Blueprint
// shape. Moved from Tovu (content/agent-plugins/render/deploy-configs/__tests__/render.test.mjs);
// the cases that drive Tovu's CLI or pack through Tovu's lifecycle stay with Tovu's overlay tests.

class FakeValidationError extends Error {}

const kit = {
  assertNoConfigInjection: (label, value) => {
    if (/["\r\n:#{[&*]/.test(value) || value.startsWith("-") || value !== value.trim()) throw new FakeValidationError(`unsafe ${label}`);
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
  secrets: [
    { name: "ADMIN_PASSWORD", requirement: "boot-blocking" },
    { name: "SITE_KEY", requirement: "recommended" },
  ],
};

const render = (options, descriptor = DESCRIPTOR) => generator.render(descriptor, options, kit);

const yamlWith = (envLines) => `services:
  - type: web
    name: acme-app
    runtime: docker
    plan: starter
    region: oregon
    healthCheckPath: /readyz
    envVars:
${envLines}
      - key: ADMIN_PASSWORD
        sync: false
      - key: SITE_KEY
        sync: false
    disk:
      name: acme_data
      mountPath: /srv/data
      sizeGB: 10
`;

test("exact render.yaml for a known descriptor: PORT from the descriptor, no host runtime switch defaulted", () => {
  const result = render({ region: "oregon" });
  assert.equal(result.filename, "render.yaml");
  assert.equal(result.contents, yamlWith(`      - key: PORT
        value: "4000"`));
  assert.doesNotMatch(result.contents, /RUNTIME_MODE/);
});

test("bug 376 regression: every options.env variable the host passes reaches render.yaml, after PORT", () => {
  const result = render({ region: "oregon", env: { APP_MODE: "production", SITE_ID: "site_01" } });
  assert.equal(result.contents, yamlWith(`      - key: PORT
        value: "4000"
      - key: APP_MODE
        value: "production"
      - key: SITE_ID
        value: "site_01"`));
});

test("options.env may override PORT, which is then emitted once, in the host's position", () => {
  const { contents } = render({ region: "oregon", env: { PORT: "8080" } });
  assert.equal(contents.match(/key: PORT/g).length, 1);
  assert.ok(contents.includes(`      - key: PORT\n        value: "8080"\n`));
});

test("values are YAML double-quoted scalars, so quotes and YAML-like scalars stay strings", () => {
  const env = { A: 'say "hi" \\ there', B: "true", C: "123", D: "null", E: "a: b # c", F: "{x: 1}", G: "it's", H: "\u007f\u0085" };
  const { contents } = render({ region: "oregon", env });
  for (const line of [
    String.raw`        value: "say \"hi\" \\ there"`,
    '        value: "true"',
    '        value: "123"',
    '        value: "null"',
    '        value: "a: b # c"',
    '        value: "{x: 1}"',
    `        value: "it's"`,
    String.raw`        value: "\u007f\u0085"`,
  ]) assert.ok(contents.includes(`${line}\n`), line);
});

test("an empty env map renders byte-identically to no env map", () => {
  assert.equal(render({ region: "oregon", env: {} }).contents, render({ region: "oregon" }).contents);
});

test("refuses lower-case or malformed names, non-strings, line breaks and declared secrets, never echoing the value", () => {
  for (const env of [
    { app_mode: "x" },
    { "1ABC": "x" },
    { "A-B": "x" },
    { A: 1 },
    { A: "line\nbreak" },
    { A: "carriage\rreturn" },
    { SITE_KEY: "secret-value" },
  ]) {
    assert.throws(() => render({ region: "oregon", env }), (error) => {
      assert.ok(error instanceof FakeValidationError);
      assert.match(error.message, /upper-case names/);
      assert.doesNotMatch(error.message, /secret-value|break|carriage/);
      return true;
    });
  }
});

test("declared secrets appear by name only: sync false in the file, a Dashboard note each", () => {
  const result = render({ region: "oregon" });
  assert.doesNotMatch(result.contents, /value: .*(password|key)/i);
  assert.ok(result.notes.includes("ADMIN_PASSWORD is boot-blocking — set its value in the Render Dashboard."));
  assert.ok(result.notes.includes("HOST MIGRATIONS NOTE"));
});

test("notes carry no host-specific opt-ins: the host appends its own after render", () => {
  assert.doesNotMatch(render({ region: "oregon" }).notes.join("\n"), /TOVU|Chromium/);
});

test("rejects a missing or unknown region rather than defaulting to Render's own oregon", () => {
  assert.throws(() => render({ region: "  " }), /--region is required/);
  assert.throws(() => render({ region: "iad" }), /not a valid Render region/);
  for (const region of RENDER_VALID_REGIONS) assert.match(render({ region }).contents, new RegExp(`region: ${region}\\n`));
});

test("app and disk names go through the host's injection guard before they reach unquoted YAML", () => {
  assert.throws(() => render({ region: "oregon" }, { ...DESCRIPTOR, appName: "evil: true" }), /unsafe the derived Render service name/);
  assert.throws(() => render({ region: "oregon" }, { ...DESCRIPTOR, volumeName: "-x" }), /unsafe the derived Render disk name/);
});
