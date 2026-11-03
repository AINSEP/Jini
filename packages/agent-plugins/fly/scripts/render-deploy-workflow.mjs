#!/usr/bin/env node
/**
 * @file Renders `skills/fly/references/fly-deploy.template.yml` into a GitHub Actions deploy workflow.
 *
 * One template serves two readers. An operator's assistant copies it by hand and fills its
 * `<<PLACEHOLDER: ...>>` values; a host's own production deploy is rendered from it with that host's
 * values file, so the shared parts of the workflow live here in the Fly plugin and only the host's
 * own parts live with the host. The host's committed workflow is OUTPUT: the host's drift test
 * fails while it differs from a fresh render.
 *
 * Template regions, one marker per line: `#>> <name>` ... `#<< <name>`. A region holds the operator
 * default. When the values file names a block for `<name>`, the block's file replaces the whole
 * region; otherwise the default stays. Regions do not nest. Every placeholder, in the template and
 * in the blocks, must have a value; a missing one throws rather than shipping a workflow that
 * deploys `<<PLACEHOLDER: ...>>`.
 *
 * Values file (JSON): `{ output, placeholders: { "<<PLACEHOLDER: ...>>": value }, blocks: { name:
 * "relative/file.yml" } }`. Block paths resolve against the values file's own folder; `output` is
 * relative to `--repo-root`. Nothing about any host is defaulted here.
 *
 * Usage: `node render-deploy-workflow.mjs --values <file> --repo-root <dir> [--check]` writes the
 * values file's `output`, or with `--check` exits 1 when the committed file differs. A missing
 * `--values` or `--repo-root` exits 2.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const OPEN = /^#>> ([a-z0-9-]+)$/;
const CLOSE = /^#<< ([a-z0-9-]+)$/;
const PLACEHOLDER = /<<PLACEHOLDER:[^>]+>>/g;
const USAGE = "usage: render-deploy-workflow.mjs --values <file> --repo-root <dir> [--check]";

export const PLUGIN_ROOT = path.resolve(import.meta.dirname, "..");
export const TEMPLATE_PATH = path.join(PLUGIN_ROOT, "skills", "fly", "references", "fly-deploy.template.yml");

/** Opens a region; a second open before the first closes is a template error. */
function openRegion({ current, name, lineNumber }) {
  if (current) throw new Error(`Line ${lineNumber}: region '${name}' opened inside '${current}'`);
  return name;
}

function closeRegion({ current, name, lineNumber }) {
  if (current !== name) throw new Error(`Line ${lineNumber}: '#<< ${name}' does not close an open region`);
  return null;
}

function substitute({ line, placeholders }) {
  return line.replace(PLACEHOLDER, (token) => {
    if (!Object.hasOwn(placeholders, token)) throw new Error(`No value for ${token}`);
    return placeholders[token];
  });
}

/** A block's text as lines; the file's own trailing newline is not an extra empty line. */
function blockLines(text) {
  return text === "" ? [] : text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
}

/**
 * Lines one template line contributes: the block on the opening marker of a replaced region,
 * nothing for any other marker or a replaced default, the line itself otherwise.
 */
function emitted({ line, region, open, blocks }) {
  if (open) return Object.hasOwn(blocks, open) ? blockLines(blocks[open]) : [];
  if (region !== null && Object.hasOwn(blocks, region)) return [];
  return [line];
}

/**
 * Renders the template text. `placeholders` maps each full `<<PLACEHOLDER: ...>>` token to its value;
 * `blocks` maps region names to replacement text. A block for a region the template lacks throws,
 * so a stale values file cannot silently drop a host step.
 * @complexity O(lines).
 */
export function renderDeployWorkflow({ template, placeholders }, { blocks = {} } = {}) {
  const out = [];
  const seen = new Set();
  let region = null;
  template.replace(/\r\n/g, "\n").split("\n").forEach((line, index) => {
    const lineNumber = index + 1;
    const open = OPEN.exec(line)?.[1] ?? null;
    const close = open ? null : CLOSE.exec(line)?.[1] ?? null;
    if (close) {
      region = closeRegion({ current: region, name: close, lineNumber });
      return;
    }
    if (open) {
      region = openRegion({ current: region, name: open, lineNumber });
      seen.add(open);
    }
    out.push(...emitted({ line, region, open, blocks }));
  });
  if (region) throw new Error(`Region '${region}' is never closed`);
  const unknown = Object.keys(blocks).filter((name) => !seen.has(name));
  if (unknown.length) throw new Error(`No template region for block(s): ${unknown.join(", ")}`);
  return out.map((line) => substitute({ line, placeholders })).join("\n");
}

/** Reads every block file the values name, relative to the values file's folder. */
function readBlocks({ readFile, valuesPath, blocks = {} }) {
  const folder = path.dirname(valuesPath);
  return Object.fromEntries(Object.entries(blocks).map(([name, file]) => [name, readFile(path.resolve(folder, file))]));
}

/**
 * Renders a host's workflow from the template and that host's values file.
 * @complexity O(template lines + block bytes).
 */
export function renderFromValues({ readFile, valuesPath }, { templatePath = TEMPLATE_PATH } = {}) {
  const values = JSON.parse(readFile(valuesPath));
  const blocks = readBlocks({ readFile, valuesPath, blocks: values.blocks });
  const contents = renderDeployWorkflow({ template: readFile(templatePath), placeholders: values.placeholders ?? {} }, { blocks });
  return { output: values.output, contents };
}

/** The value after `name` in argv, or undefined. */
function flag(argv, name) {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

/** CLI: write (default) or `--check` the rendered workflow. Returns the exit code. */
export function main({ argv, readFile, writeFile, log }, { templatePath = TEMPLATE_PATH } = {}) {
  const valuesPath = flag(argv, "--values");
  const repoRoot = flag(argv, "--repo-root");
  if (!valuesPath || !repoRoot) {
    log(USAGE);
    return 2;
  }
  const { output, contents } = renderFromValues({ readFile, valuesPath }, { templatePath });
  const target = path.join(repoRoot, output);
  if (!argv.includes("--check")) {
    writeFile(target, contents);
    log(`Rendered ${output}`);
    return 0;
  }
  if (readFile(target) === contents) return 0;
  log(`${output} differs from its render; re-run without --check`);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main({
    argv: process.argv.slice(2),
    readFile: (file) => readFileSync(file, "utf8"),
    writeFile: (file, text) => writeFileSync(file, text),
    log: (message) => console.log(message),
  });
}
