import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

interface PackageManifest {
  readonly exports: Record<string, Record<string, string>>;
  readonly bin: Record<string, string>;
}

function readManifest(): PackageManifest {
  return JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as PackageManifest;
}

// The `./bin` subpath exists so a consumer can locate this package's executable without walking
// its private build layout. Before it, `exports` declared only `"."`, so a direct
// `require.resolve('@jini-ai/mcp/dist/bin/serve.js')` failed with ERR_PACKAGE_PATH_NOT_EXPORTED
// and every consumer had to resolve the root export and guess the sibling path.
describe('@jini-ai/mcp package exports', () => {
  it('exposes the executable through a stable ./bin subpath', () => {
    expect(readManifest().exports['./bin']?.default).toBe('./dist/bin/serve.js');
  });

  it('points ./bin at the same file as the jini-mcp bin entry', () => {
    const manifest = readManifest();
    expect(manifest.exports['./bin']?.default).toBe(manifest.bin['jini-mcp']);
  });

  // `dist/bin/serve.js` only exists after a build, so assert against the source file that produces
  // it — this still fails loudly if the bin is moved or renamed without updating the manifest.
  it('resolves to a path backed by a real source file', () => {
    const declared = readManifest().exports['./bin']?.default;
    const source = declared?.replace(/^\.\/dist\//, 'src/').replace(/\.js$/, '.ts');
    expect(source).toBe('src/bin/serve.ts');
    expect(existsSync(join(packageRoot, source!))).toBe(true);
  });

  // Guards the additive-only property: adding `./bin` must not disturb the root entry.
  it('leaves the root export unchanged', () => {
    expect(readManifest().exports['.']).toEqual({
      types: './dist/index.d.ts',
      import: './dist/index.js',
      default: './dist/index.js',
    });
  });
});
