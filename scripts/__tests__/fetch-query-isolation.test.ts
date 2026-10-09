import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { auditSubpathIsolation } from '../check-subpath-isolation.js';

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
  });

  it('declares an optional v5 peer and keeps JavaScript free of package side effects', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../packages/ui/package.json', import.meta.url), 'utf8'));
    expect(manifest.peerDependencies['@tanstack/react-query']).toBe('^5.0.0');
    expect(manifest.peerDependenciesMeta['@tanstack/react-query']).toEqual({ optional: true });
    expect(manifest.dependencies['@tanstack/react-query']).toBeUndefined();
    expect(manifest.sideEffects.every((pattern: string) => pattern.endsWith('.css'))).toBe(true);
  });
});
