/** Regression fences: HTML-viewer leaf imports, native-kit assembly cycles, universal SEO/i18n closures. */
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { extractImports } from '../lib/walk-imports.js';
import { auditSubpathIsolation } from '../check-subpath-isolation.js';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

/** Follow relative runtime edges using the existing AST import owner and TypeScript resolver.
 * Bare package closures are checked by auditSubpathIsolation below, which owns that policy.
 */
function sourceClosure(entry: string) {
  const files = new Set<string>(), active = new Set<string>(), cycles: string[][] = [];
  function visit(file: string) {
    if (active.has(file)) { cycles.push([...active, file].map(path => relative(repoRoot, path))); return; }
    if (files.has(file)) return;
    files.add(file); active.add(file);
    for (const ref of extractImports(file).filter(ref => !ref.typeOnly && ref.specifier.startsWith('.'))) {
      if (ref.specifier.endsWith('.css')) continue;
      const target = ts.resolveModuleName(ref.specifier, file, {
        moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext,
      }, ts.sys).resolvedModule;
      expect(target, `${relative(repoRoot, file)} -> ${ref.specifier}`).toBeDefined();
      visit(target!.resolvedFileName);
    }
    active.delete(file);
  }
  visit(fileURLToPath(new URL(entry, new URL('../../', import.meta.url))));
  return { files: [...files].map(file => relative(repoRoot, file)), cycles };
}

describe('HTML viewer leaf imports', () => {
  it('cannot reach the renderer barrel, Markdown renderers or srcdoc assembly', () => {
    const { files } = sourceClosure('packages/ui/src/features/html-viewer/index.ts');
    expect(files).toContain('packages/ui/src/renderers/new-tab-preview.ts');
    expect(files).toContain('packages/ui/src/renderers/sandbox-bridge.ts');
    expect(files.filter(file => /renderers\/(?:index\.|.*(?:[Mm]arkdown|srcdoc))/.test(file))).toEqual([]);
  });
});

describe('native kit assembly cycles', () => {
  it.each(['packages/ui-kit/src/react/KitProvider.tsx', 'packages/ui-kit/src/react/native/index.ts', 'packages/ui-kit/src/react/context.ts'])('%s has no runtime dependency cycle', entry => {
    expect(sourceClosure(entry).cycles).toEqual([]);
  });
  it('native views and context-only lookup never load the facade or default assembly', () => {
    for (const entry of ['packages/ui-kit/src/react/native/Dialog.tsx', 'packages/ui-kit/src/react/native/Dialog.hooks.ts', 'packages/ui-kit/src/react/context.ts']) {
      expect(sourceClosure(entry).files.filter(file => /\/(?:facade|Kit\.hooks|kit)\.ts$/.test(file))).toEqual([]);
    }
  });
});

describe('universal translation owner and SEO entries', () => {
  it('keeps SEO and its HTTP adapter free of React and preserves the existing interpolation owner', () => {
    const audit = auditSubpathIsolation({ repoRoot });
    for (const [owner, subpath] of [['@jini-ai/ui', './i18n'], ['@jini-ai/admin', './seo'], ['@jini-ai/admin', './seo/adapters/http']]) {
      const entry = audit.closures.find(closure => closure.package === owner && closure.subpath === subpath);
      expect(entry).toBeDefined();
      expect(entry!.dependencies.filter(name => /^(?:react|react-dom)$/.test(name))).toEqual([]);
      expect(entry!.files).toContain('packages/ui/src/features/i18n/template-i18n.ts');
      expect(entry!.files.some(file => file.includes('/features/panel-kit/'))).toBe(false);
      expect(audit.findings.filter(finding => finding.package === owner && finding.subpath === subpath && finding.kind === 'resolution')).toEqual([]);
    }
  });
});
