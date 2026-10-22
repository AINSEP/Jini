import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { auditSubpathIsolation } from '../check-subpath-isolation.js';
import { checkPackageLayers } from '../check-package-layers.js';
import { assertPackedExports } from '../lib/packed-exports.js';

describe('fetch-query optional adapter isolation', () => {
  it('keeps TanStack out of the default runtime closure while the optional entry reaches it', () => {
    // Use the repository's AST import-closure owner, including transitive imports;
    // checking only index.ts would miss a hidden SDK import in a re-exported helper.
    const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
    const audit = auditSubpathIsolation({ repoRoot });
    const entry = (subpath: string) => audit.closures.find(closure => closure.package === '@jini-ai/ui' && closure.subpath === subpath);
    expect(entry('./fetch-query')).toBeDefined();
    expect(entry('./fetch-query')!.dependencies.some(dependency => dependency.startsWith('@tanstack/'))).toBe(false);
    expect(entry('./fetch-query/tanstack')!.dependencies).toContain('@tanstack/react-query');
    expect(audit.findings.filter(finding => finding.package === '@jini-ai/ui' && finding.subpath.startsWith('./fetch-query'))).toEqual([]);
    const core = audit.closures.find(closure => closure.package === '@jini-ai/core' && closure.subpath === './fetch');
    expect(core).toBeDefined();
    expect(core!.dependencies).toEqual([]);
    expect(core!.files).toContain('packages/core/src/fetch/cache.ts');
    expect(core!.files.every(file => file.startsWith('packages/core/src/'))).toBe(true);
    expect(entry('./fetch-query')!.files).toContain('packages/core/src/fetch/cache.ts');
    expect(entry('./fetch-query/tanstack')!.files).toContain('packages/core/src/fetch/cache.ts');
    expect(audit.findings.filter(finding => finding.package === '@jini-ai/core' && finding.subpath === './fetch')).toEqual([]);
    expect(checkPackageLayers({ repoRoot }).filter(finding =>
      finding.file.startsWith('packages/core/src/fetch/') || finding.file.startsWith('packages/ui/src/features/panel-kit/fetch-query/'))).toEqual([]);
  });

  it('publishes a universal fetch entry with both runtime and declaration targets required by the packed-exports guard', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../packages/core/package.json', import.meta.url), 'utf8'));
    expect(manifest.jini.entries['./fetch']).toBe('universal');
    expect(manifest.exports['./fetch']).toEqual({
      types: './dist/fetch/index.d.ts', import: './dist/fetch/index.js', default: './dist/fetch/index.js',
    });
    const fetchManifest = { name: manifest.name, exports: { './fetch': manifest.exports['./fetch'] } };
    const packedPaths = ['package/dist/fetch/index.js', 'package/dist/fetch/index.d.ts'];
    expect(() => assertPackedExports({ manifest: fetchManifest, packedPaths })).not.toThrow();
    expect(() => assertPackedExports({ manifest: fetchManifest, packedPaths: packedPaths.slice(0, 1) })).toThrow(
      '@jini-ai/core: exported paths missing from tarball: ./dist/fetch/index.d.ts');
  });

  it('declares an optional v5 peer and keeps JavaScript free of package side effects', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../packages/ui/package.json', import.meta.url), 'utf8'));
    expect(manifest.peerDependencies['@tanstack/react-query']).toBe('^5.0.0');
    expect(manifest.peerDependenciesMeta['@tanstack/react-query']).toEqual({ optional: true });
    expect(manifest.dependencies['@tanstack/react-query']).toBeUndefined();
    expect(manifest.sideEffects.every((pattern: string) => pattern.endsWith('.css'))).toBe(true);
  });
});
