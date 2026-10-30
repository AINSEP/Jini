/** Coupling audit findings 1–2: protect public source closures using the existing graph owner. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';
import { auditSubpathIsolation, type SubpathIsolationAudit } from '../check-subpath-isolation.js';
import { extractImports } from '../lib/walk-imports.js';
import { checkPackageLayers } from '../check-package-layers.js';
import { checkEngineBoundaries } from '../check-engine-boundaries.js';
import { createHardwiringInspector } from '../../packages/devops/src/checks/hardwiring.js';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
let audit: SubpathIsolationAudit;
beforeAll(() => { audit = auditSubpathIsolation({ repoRoot }); });

describe('platform OS helper import isolation', () => {
  // Local scanner/Windows hardening refactors reuse Core; pin their exact closures too.
  const primitives = ['http', 'ids', 'index', 'json', 'logger', 'paths', 'result', 'sse', 'tasks', 'time', 'trim-chars']
    .map(name => `packages/core/src/primitives/${name}.ts`);
  const text = ['escape', 'index', 'line-tail', 'sanitize-untrusted-text']
    .map(name => `packages/core/src/text/${name}.ts`)
    .concat('packages/core/src/redact.ts', 'packages/core/src/primitives/trim-chars.ts');
  it.each(['command', 'process', 'toolchain', 'proxy-env', 'shell', 'child-environment'])('%s reaches only its existing OS owners', name => {
    const entry = audit.closures.find(closure => closure.package === '@jini-ai/platform' && closure.subpath === `./${name}`);
    // Exact closure checks catch indirect barrel loads, including services without external deps.
    const files = [`packages/platform/src/${name}.ts`];
    if (name === 'command' || name === 'process') files.push(...primitives);
    if (name === 'process' || name === 'proxy-env') files.push(...text);
    if (name === 'process') files.push('packages/platform/src/command.ts', 'packages/platform/src/shell.ts',
      'packages/platform/src/windows-system-tools.ts');
    expect(entry?.files).toEqual([...new Set(files)].sort());
    // Core reuse is intentional (d62cf2a9f); Undici, drivers and renderer SDKs remain excluded.
    expect(entry?.dependencies).toEqual(['command', 'process', 'proxy-env'].includes(name) ? ['@jini-ai/core'] : []);
    expect(audit.findings.filter(finding => finding.package === '@jini-ai/platform'
      && finding.subpath === `./${name}` && (finding.kind === 'a' || finding.kind === 'resolution'))).toEqual([]);
  });
});

describe('model-discovery policy import isolation', () => {
  it('cannot reach native process/filesystem modules or its adapter implementations', () => {
    const entry = audit.closures.find(closure => closure.package === '@jini-ai/agent-runtime' && closure.subpath === './model-discovery');
    expect(entry?.files).toEqual([
      'packages/agent-runtime/src/core/model-discovery-shared.ts',
      'packages/agent-runtime/src/model-discovery-config.ts',
      'packages/agent-runtime/src/model-discovery-yaml.ts',
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
    ['@jini-ai/platform', './mail'],
    ['@jini-ai/platform', './net'],
    ['@jini-ai/platform', './web'],
    ['@jini-ai/platform', './asset-cache'],
    ['@jini-ai/devops', './source-control'],
    ['@jini-ai/devops', './static-export/failure-summary'],
  ])('%s%s crosses no domain boundary', (owner, subpath) => {
    expect(audit.findings.filter(finding => finding.package === owner
      && finding.subpath === subpath && (finding.kind === 'a' || finding.kind === 'resolution'))).toEqual([]);
  });

  it('only the web entry reaches HTML peers; the root and asset cache retain lazy Undici access', () => {
    const htmlPeers = ['parse5', 'hast-util-from-parse5', 'hast-util-to-mdast', 'mdast-util-to-markdown', 'mdast-util-gfm-table'].sort();
    const platform = audit.closures.filter(closure => closure.package === '@jini-ai/platform');
    for (const closure of platform) {
      expect(closure.dependencies.filter(name => htmlPeers.includes(name)).sort()).toEqual(closure.subpath === './web' ? htmlPeers : []);
    }
    expect(platform.find(closure => closure.subpath === '.')?.dependencies).toContain('undici');
    expect(platform.find(closure => closure.subpath === './asset-cache')?.dependencies).toEqual(['undici']);
  });

  it('clears platform and infra subset dependency findings without weakening the guard', () => {
    expect(audit.findings.filter(finding => ['@jini-ai/platform', '@jini-ai/infra'].includes(finding.package)
      && finding.rule === 'SI-dependency')).toEqual([]);
    const outbox = audit.closures.find(closure => closure.package === '@jini-ai/infra' && closure.subpath === './events/outbox');
    expect(outbox?.dependencies).toEqual(['@jini-ai/core']);
    expect(outbox?.files.some(file => file.startsWith('packages/db/'))).toBe(false);
  });
});

describe('re-verify dependency and state regressions', () => {
  it('keeps standalone plugin tooling on package public entries', async () => {
    expect((await checkEngineBoundaries({ repoRoot })).filter(finding => finding.rule === 'R2-deep-path'
      && finding.file.startsWith('packages/plugin-'))).toEqual([]);
  });

  it('declares the shared secret-input owner on the permitted optional UI layer edge', () => {
    expect(checkPackageLayers({ repoRoot }).filter(finding => finding.file.startsWith('packages/ui/')
      && finding.reason.startsWith('ui → @jini-ai/ui-kit'))).toEqual([]);
    expect(audit.findings.filter(finding => finding.package === '@jini-ai/ui'
      && finding.rule === 'SI-dependency')).toEqual([]);
    const pkg = JSON.parse(readFileSync(new URL('../../packages/ui/package.json', import.meta.url), 'utf8'));
    expect(pkg.devDependencies['@jini-ai/ui-kit']).toBe('workspace:^');
    expect(pkg.peerDependencies['@jini-ai/ui-kit']).toBe('^0.6.10');
    expect(pkg.peerDependenciesMeta['@jini-ai/ui-kit']).toEqual({ optional: true });
  });

  it.each([
    'packages/devops/src/static-export/css-urls.ts',
    'packages/provider-plugins/src/payments-stripe/webhook.ts',
  ])('%s owns no mutable module state', file => {
    const source = readFileSync(new URL(file, new URL('../../', import.meta.url)), 'utf8');
    const inspector = createHardwiringInspector({ compiler: ts });
    expect(inspector.inspect({ file, source, mode: 'jini', server: true })
      .filter(finding => finding.rule === 'HW3-module-state')).toEqual([]);
  });
});
