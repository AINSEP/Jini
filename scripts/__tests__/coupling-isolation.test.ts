/** Coupling audit findings 1–2: protect public source closures using the existing graph owner. */
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { auditSubpathIsolation, type SubpathIsolationAudit } from '../check-subpath-isolation.js';
import { extractImports } from '../lib/walk-imports.js';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
let audit: SubpathIsolationAudit;
beforeAll(() => { audit = auditSubpathIsolation({ repoRoot }); });

describe('platform OS helper import isolation', () => {
  it.each(['command', 'process', 'toolchain', 'proxy-env', 'shell', 'child-environment'])('%s reaches only its existing OS owners', name => {
    const entry = audit.closures.find(closure => closure.package === '@jini-ai/platform' && closure.subpath === `./${name}`);
    // Exact closure checks catch indirect barrel loads, including services without external deps.
    const files = [`packages/platform/src/${name}.ts`];
    if (name === 'process') files.push('packages/platform/src/command.ts');
    expect(entry?.files).toEqual(files.sort());
    expect(entry?.dependencies).toEqual([]); // In particular, no Undici, drivers or renderer SDKs.
    expect(audit.findings.filter(finding => finding.package === '@jini-ai/platform'
      && finding.subpath === `./${name}` && (finding.kind === 'a' || finding.kind === 'resolution'))).toEqual([]);
  });
});

describe('model-discovery policy import isolation', () => {
  it('cannot reach native process/filesystem modules or its adapter implementations', () => {
    const entry = audit.closures.find(closure => closure.package === '@jini-ai/agent-runtime' && closure.subpath === './model-discovery');
    expect(entry?.files).toEqual([
      'packages/agent-runtime/src/model-discovery-config.ts',
      'packages/agent-runtime/src/model-discovery-shared.ts',
      'packages/agent-runtime/src/model-discovery.ts',
    ]);
    expect(entry?.dependencies).toEqual([]);
    const runtimeImports = entry!.files.flatMap(file => extractImports(fileURLToPath(new URL(file, new URL('../../', import.meta.url)))))
      .filter(ref => !ref.typeOnly).map(ref => ref.specifier);
    expect(runtimeImports.filter(specifier => /^(?:node:)?(?:child_process|fs)(?:\/|$)/.test(specifier))).toEqual([]);
    expect(audit.findings.filter(finding => finding.package === '@jini-ai/agent-runtime'
      && finding.subpath === './model-discovery' && finding.kind === 'resolution')).toEqual([]);
    // The root keeps native composition and is allowed to load the adapters: the guard must distinguish it.
    const native = audit.closures.find(closure => closure.package === '@jini-ai/agent-runtime' && closure.subpath === '.');
    expect(native?.files).toContain('packages/agent-runtime/src/model-discovery-adapters.ts');
    expect(native?.files).toContain('packages/agent-runtime/src/model-discovery-sdk.ts');
  });
});


describe('verified shared leaves retain their existing owners', () => {
  it.each([
    ['@jini-ai/platform', './http/guarded'],
    ['@jini-ai/platform', './net'],
    ['@jini-ai/platform', './web'],
    ['@jini-ai/devops', './source-control'],
    ['@jini-ai/devops', './static-export/failure-summary'],
  ])('%s%s crosses no domain boundary', (owner, subpath) => {
    expect(audit.findings.filter(finding => finding.package === owner
      && finding.subpath === subpath && (finding.kind === 'a' || finding.kind === 'resolution'))).toEqual([]);
  });

  it('only the web entry loads HTML peers; the platform root keeps its required Undici', () => {
    const htmlPeers = ['parse5', 'hast-util-from-parse5', 'hast-util-to-mdast', 'mdast-util-to-markdown', 'mdast-util-gfm-table'].sort();
    const platform = audit.closures.filter(closure => closure.package === '@jini-ai/platform');
    for (const closure of platform) {
      expect(closure.dependencies.filter(name => htmlPeers.includes(name)).sort()).toEqual(closure.subpath === './web' ? htmlPeers : []);
    }
    expect(platform.find(closure => closure.subpath === '.')?.dependencies).toContain('undici');
  });
});
