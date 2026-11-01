/**
 * The one reader of `npm pack --json` output for scripts and packed-tarball tests.
 * npm 11 prints an array of entries; npm 12 prints an object keyed by package name
 * (npm/cli#9247, made consistent with `npm publish --json`). Indexing `[0]` on the npm 12
 * shape is what broke publish.yml once it installed npm@latest.
 * Plain JS with a .d.ts so plain-Node fixtures (scripts/testing/packed-fixture.js) can import it too.
 * @param {{ stdout: string }} required Raw stdout of `npm pack --json` for one package.
 * @returns {{ filename: string, files?: { path: string }[] }} That package's entry.
 * @throws {Error} When the output is not exactly one entry with a filename.
 */
export function parseNpmPackJson({ stdout }) {
  const parsed = JSON.parse(stdout);
  const entries = Array.isArray(parsed) ? parsed : parsed !== null && typeof parsed === 'object' ? Object.values(parsed) : [];
  if (entries.length !== 1) throw new Error(`npm pack --json: expected exactly one packed package, got ${entries.length}`);
  if (typeof entries[0]?.filename !== 'string') throw new Error('npm pack --json: entry has no filename');
  return entries[0];
}
