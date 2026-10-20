/**
 * @file Vendor-neutrality pin for the generic seams the first provider plugin is built on: API
 * connections, the installed-app loopback receiver, executable tool contributions and plugin admin
 * surfaces. Those seams must carry opaque plugin/connection/product ids only, so a second provider
 * needs nothing but its own plugin files.
 * This test greps every seam file (sources, READMEs and their tests) for the first provider's
 * vocabulary and fails on any hit, naming file and line. Provider names belong in the plugin.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect, test } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const VENDOR_VOCABULARY = /google|googleapis|gsheets|spreadsheet|drive\.file|picker/i;
const SCANNED_EXTENSIONS = new Set(['.ts', '.mts', '.mjs', '.js', '.json', '.md', '.html']);

/** The generic seam files and folders (repo-relative). Folders are scanned recursively. */
const SEAMS = [
  'packages/integrations/src/api-connections',
  'packages/oauth/src/loopback-receiver.ts',
  'packages/oauth/src/loopback-callback.ts',
  'packages/oauth/tests/loopback-receiver.security.test.ts',
  'packages/oauth/tests/loopback-receiver.slice.test.ts',
  'packages/agent-plugins/src/lifecycle',
  'packages/agent-plugins/src/admin-surfaces',
  'packages/plugins/src/host/tool-contributions.ts',
  'packages/plugins/src/host/contributions.ts',
];

/** Every scannable file under `target` (a file or a folder), skipping build output and installs. */
function filesUnder(target: string): string[] {
  if (statSync(target).isFile()) return [target];
  return readdirSync(target, { withFileTypes: true })
    .filter((entry) => entry.name !== 'node_modules' && entry.name !== 'dist')
    .flatMap((entry) => (entry.isDirectory() ? filesUnder(path.join(target, entry.name)) : [path.join(target, entry.name)]))
    .filter((file) => SCANNED_EXTENSIONS.has(path.extname(file)));
}

/** `relative/path:line: text` for every line of `files` that names the vendor vocabulary. */
function vendorHits(files: readonly string[], root: string): string[] {
  return files.flatMap((file) => readFileSync(file, 'utf8').split('\n')
    .flatMap((line, index) => (VENDOR_VOCABULARY.test(line) ? [`${path.relative(root, file)}:${index + 1}: ${line.trim()}`] : [])));
}

const scratch = mkdtempSync(path.join(tmpdir(), 'vendor-neutrality-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

test('the scanner reports a vendor word with its file and line, in any case', () => {
  writeFileSync(path.join(scratch, 'seam.ts'), 'const ok = 1;\n// opens the Picker\n');
  expect(vendorHits(filesUnder(scratch), scratch)).toStrictEqual(['seam.ts:2: // opens the Picker']);
});

test('no generic seam file names the first provider', () => {
  const files = SEAMS.flatMap((seam) => {
    const scanned = filesUnder(path.join(repoRoot, seam));
    // A moved or emptied seam must fail loudly, not pass by scanning nothing.
    expect(scanned.length, `${seam} has no scannable files`).toBeGreaterThan(0);
    return scanned;
  });
  expect(files.length).toBeGreaterThan(40);
  expect(vendorHits(files, repoRoot)).toStrictEqual([]);
});
