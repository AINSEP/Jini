import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { main, renderDeployWorkflow, renderFromValues, TEMPLATE_PATH } from "../render-deploy-workflow.mjs";

// The renderer's region and placeholder rules, its values-file wiring and its CLI. A host's own
// committed workflow is pinned by that host's drift test, not here: nothing here knows any host.

const readFile = (file) => readFileSync(file, "utf8");

test("a region keeps its operator default unless a block replaces the whole region", () => {
  const template = ["a", "#>> x", "default", "#<< x", "b"].join("\n");
  assert.equal(renderDeployWorkflow({ template, placeholders: {} }), "a\ndefault\nb");
  assert.equal(renderDeployWorkflow({ template, placeholders: {} }, { blocks: { x: "host 1\nhost 2\n" } }), "a\nhost 1\nhost 2\nb");
});

test("an empty default region renders nothing, and a block with a trailing blank line keeps it", () => {
  const template = ["a", "#>> x", "#<< x", "b"].join("\n");
  assert.equal(renderDeployWorkflow({ template, placeholders: {} }), "a\nb");
  assert.equal(renderDeployWorkflow({ template, placeholders: {} }, { blocks: { x: "host\n\n" } }), "a\nhost\n\nb");
});

test("placeholders are filled in the template and inside blocks; a missing value throws instead of shipping the token", () => {
  const template = ["branches: [<<PLACEHOLDER: branch>>]", "#>> x", "#<< x"].join("\n");
  const blocks = { x: "version: <<PLACEHOLDER: version>>" };
  assert.equal(renderDeployWorkflow({ template, placeholders: { "<<PLACEHOLDER: branch>>": "main", "<<PLACEHOLDER: version>>": "1.2.3" } }, { blocks }), "branches: [main]\nversion: 1.2.3");
  assert.throws(() => renderDeployWorkflow({ template, placeholders: { "<<PLACEHOLDER: branch>>": "main" } }, { blocks }), /No value for <<PLACEHOLDER: version>>/);
});

test("a block for a region the template does not have throws, so a stale values file cannot drop a step", () => {
  assert.throws(() => renderDeployWorkflow({ template: "a", placeholders: {} }, { blocks: { gone: "x" } }), /No template region for block\(s\): gone/);
});

test("malformed regions are template errors", () => {
  const render = (lines) => () => renderDeployWorkflow({ template: lines.join("\n"), placeholders: {} });
  assert.throws(render(["#>> x", "y"]), /Region 'x' is never closed/);
  assert.throws(render(["#<< x"]), /Line 1: '#<< x' does not close an open region/);
  assert.throws(render(["#>> x", "#>> y"]), /Line 2: region 'y' opened inside 'x'/);
  assert.throws(render(["#>> x", "#<< y"]), /Line 2: '#<< y' does not close/);
});

test("the shipped template is host-neutral: its operator render has placeholders but no host text or markers", () => {
  const template = readFile(TEMPLATE_PATH);
  assert.doesNotMatch(template, /tovu|TOVU_/i);
  const placeholders = Object.fromEntries([...template.matchAll(/<<PLACEHOLDER:[^>]+>>/g)].map(([token]) => [token, "X"]));
  const contents = renderDeployWorkflow({ template, placeholders });
  assert.doesNotMatch(contents, /^#(>>|<<) /m);
  assert.match(contents, /^      - run: flyctl deploy --remote-only$/m);
  assert.match(contents, /^  deploy:$/m);
});

/** In-memory files under a virtual root, falling back to the real template. */
function memoryIo(files) {
  const logs = [];
  return {
    logs,
    io: {
      readFile: (file) => (files.has(file) ? files.get(file) : readFile(file)),
      writeFile: (file, text) => files.set(file, text),
      log: (message) => logs.push(message),
    },
  };
}

test("renderFromValues resolves block files against the values file's own folder", () => {
  const files = new Map([
    ["/host/overlay/values.json", JSON.stringify({ output: "out.yml", placeholders: { "<<PLACEHOLDER: v>>": "7" }, blocks: { x: "blocks/x.yml" } })],
    ["/host/overlay/blocks/x.yml", "host <<PLACEHOLDER: v>>\n"],
    ["/tpl.yml", "a\n#>> x\n#<< x\nb"],
  ]);
  const { io } = memoryIo(files);
  assert.deepEqual(renderFromValues({ readFile: io.readFile, valuesPath: "/host/overlay/values.json" }, { templatePath: "/tpl.yml" }), { output: "out.yml", contents: "a\nhost 7\nb" });
});

test("the CLI refuses a missing --values or --repo-root, writes the render, and --check reports a stale file", () => {
  const files = new Map([
    ["/host/values.json", JSON.stringify({ output: "wf.yml", placeholders: {}, blocks: {} })],
    ["/tpl.yml", "name: x"],
  ]);
  const { io, logs } = memoryIo(files);
  const options = { templatePath: "/tpl.yml" };
  assert.equal(main({ ...io, argv: [] }, options), 2);
  assert.equal(main({ ...io, argv: ["--repo-root", "/repo"] }, options), 2);
  assert.equal(main({ ...io, argv: ["--values", "/host/values.json"] }, options), 2);
  assert.match(logs.at(-1), /usage: render-deploy-workflow\.mjs --values <file> --repo-root <dir>/);
  const argv = ["--values", "/host/values.json", "--repo-root", "/repo"];
  assert.equal(main({ ...io, argv }, options), 0);
  assert.equal(files.get(path.join("/repo", "wf.yml")), "name: x");
  assert.equal(main({ ...io, argv: [...argv, "--check"] }, options), 0);
  files.set(path.join("/repo", "wf.yml"), "stale");
  assert.equal(main({ ...io, argv: [...argv, "--check"] }, options), 1);
  assert.match(logs.at(-1), /wf\.yml differs from its render/);
});
