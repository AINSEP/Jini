/** Negative and positive fixtures for the consolidated publish guards.
 * They run inside guard before its real-tree scan, so removing a rule cannot print a false OK.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkPackageLayers } from '../check-package-layers.js';
import { checkSourceNeutrality } from './source-neutrality.js';

export function runPublishHygieneSelfTest(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): string[] {
  const root = mkdtempSync(join(tmpdir(), 'jini-publish-guard-'));
  const failures: string[] = [];
  function write(file: string, content: string): void {
    const path = join(root, file);
    mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content);
  }
  function manifest(name: string, dependencies: Record<string, string> = {}, extra: object = {}): void {
    write(`packages/${name}/package.json`, JSON.stringify({ name: `@jini-ai/${name}`, dependencies, ...extra }));
  }
  function expect(condition: boolean, description: string): void { if (!condition) failures.push(description); }
  try {
    write('scripts/source-neutrality-allowlist.json', '[]');
    manifest('core'); manifest('protocol', { '@jini-ai/core': '*' });
    manifest('platform', { '@jini-ai/core': '*' }); manifest('sidecar');
    manifest('cli', { '@jini-ai/sidecar': '*' });
    manifest('oauth', { '@jini-ai/mcp': '*' }); manifest('mcp', { '@jini-ai/oauth': '*' });
    manifest('http-kit', { '@jini-ai/cms': '*' }); manifest('cms');
    manifest('chat', { '@jini-ai/platform': '*', '@jini-ai/ui': '*' }); manifest('ui', { '@jini-ai/platform': '*' });
    manifest('analytics', { '@jini-ai/core': '*' });
    manifest('sqlite', { '@jini-ai/server': '*' }); manifest('server');
    manifest('user-management', {}, { peerDependencies: { '@jini-ai/ui': '*' }, peerDependenciesMeta: { '@jini-ai/ui': { optional: true } } });
    // REGRESSION: fails if neutrality is case-sensitive or strips consumer identity comments.
    write('packages/core/src/identity.mts', '// tOvU consumer\nexport const value = 1;');
    // REGRESSION: fails if only the website path is forbidden.
    write('packages/core/src/path.cts', '// apps/desktop/bootstrap\nexport const value = 1;');
    const forbidden = ['Settings →', 'this site', 'EXTERNAL_MCP', 'g3-approval', 'U-001', 'REQ-42', 'SEC-42', 'INV-42', 'SPEC-42'];
    for (const [index, token] of forbidden.entries()) {
      write(`packages/core/src/literal-${index}.ts`, `export const value = ${JSON.stringify(token)};`);
    }
    // REGRESSION: fails if template substitutions hide a runtime specification ID.
    write('packages/core/src/template.ts', 'export const value = `host ${42} SPEC-42`;');
    write('packages/core/src/css.css', 'a { content: "this site"; }');
    write('packages/core/src/jsx.tsx', 'export const view = <p>this site</p>;');
    // PARITY: specification references remain legal in rationale comments, URLs and regexes
    // must not make the parser discard a following runtime literal.
    write('packages/core/src/ok.ts', '// SPEC-42; this site was the old wording\nexport const url = "https://example.com";\nexport const pattern = /https?:\\/\\//;');
    write('packages/core/src/after-regex.ts', 'export const pattern = /https?:\\/\\//; export const value = "REQ-42";');
    write('packages/core/src/escaped.ts', 'export const value = "R\\u0045Q-42";');
    write('packages/core/src/__tests__/fixture.ts', 'export const value = "tovu";');
    write('packages/core/src/fixture.test.ts', 'export const value = "tovu";');
    const neutrality = checkSourceNeutrality({ repoRoot: root });
    const has = (file: string, rule?: string) => neutrality.some(v => v.file.endsWith(file) && (!rule || v.rule === rule));
    expect(has('identity.mts', 'N1-consumer-identity'), 'identity comments must fail case-insensitively');
    expect(has('path.cts', 'N2-consumer-path'), 'desktop path comments must fail');
    for (let index = 0; index < forbidden.length; index++) expect(has(`literal-${index}.ts`), `literal ${forbidden[index]} must fail`);
    for (const file of ['template.ts', 'css.css', 'jsx.tsx', 'after-regex.ts', 'escaped.ts']) expect(has(file), `${file} must fail`);
    expect(!has('ok.ts'), 'neutral URLs/regexes and rationale comments must pass');
    expect(!has('fixture.ts') && !has('fixture.test.ts'), 'both test exclusions must work');
    write('scripts/source-neutrality-allowlist.json', JSON.stringify([{ file: 'packages/core/src/identity.mts', rule: 'N1-consumer-identity', reason: '' }]));
    expect(checkSourceNeutrality({ repoRoot: root }).some(v => v.rule === 'N0-allowlist'), 'empty exception reason must fail');
    write('scripts/source-neutrality-allowlist.json', JSON.stringify([{ file: 'packages/core/src/identity.mts', rule: 'N1-consumer-identity', reason: 'fixture exception' }]));
    expect(!checkSourceNeutrality({ repoRoot: root }).some(v => v.file.endsWith('identity.mts')), 'exact reasoned exception must work');
    // REGRESSION: fails if layers scan only manifests or ignore type-only imports.
    write('packages/core/src/up.ts', "import type { X } from '@jini-ai/platform';");
    write('packages/cli/src/ok.ts', "import { X } from '@jini-ai/sidecar';");
    write('packages/chat/src/bad.ts', "import { X } from '@jini-ai/platform/fs';");
    write('packages/ui/src/ok.ts', "import { X } from '@jini-ai/platform/fetch-with-timeout';");
    write('packages/user-management/src/react/ok.ts', "import { X } from '@jini-ai/ui';");
    write('packages/user-management/src/core/bad.ts', "import { X } from '@jini-ai/ui';");
    // REGRESSION: fails if the approved chat React peer edge is rejected.
    write('packages/chat/src/react/components/ok.tsx', "import { X } from '@jini-ai/ui'; import { Y } from '@jini-ai/ui/a2ui';");
    write('packages/chat/src/react/hooks/ok.ts', "import type { X } from '@jini-ai/ui/mcp-ui';");
    // REGRESSION: fails if the React exception leaks into framework-free chat code.
    write('packages/chat/src/core/bad.tsx', "import { X } from '@jini-ai/ui'; const y = import('@jini-ai/ui/mcp-ui');");
    write('packages/chat/src/reactive/bad.ts', "const x = require('@jini-ai/ui');");
    // REGRESSION: fails if analytics is omitted from L4 or allowed a domain peer.
    write('packages/analytics/src/ok.ts', "import type { X } from '@jini-ai/core/primitives';");
    write('packages/analytics/src/bad.ts', "import { X } from '@jini-ai/chat';");
    const layers = checkPackageLayers({ repoRoot: root });
    const layerHas = (file: string, rule: string) => layers.some(v => v.file.endsWith(file) && v.rule === rule);
    expect(layerHas('core/src/up.ts', 'L1-layer-edge'), 'upward type-only source import must fail');
    expect(layerHas('http-kit/package.json', 'L1-layer-edge'), 'upward manifest edge must fail');
    expect(layerHas('oauth/package.json', 'L1-layer-edge') && layerHas('mcp/package.json', 'L1-layer-edge'), 'both MCP/OAuth directions must fail');
    expect(layerHas('chat/src/bad.ts', 'L2-browser-platform'), 'browser platform subpath must fail');
    expect(layerHas('user-management/src/core/bad.ts', 'L1-layer-edge'), 'optional React peer must stay in React integration');
    expect(!layerHas('chat/package.json', 'L1-layer-edge'), 'chat UI declaration must cover React integration');
    expect(layerHas('chat/src/core/bad.tsx', 'L1-layer-edge') && layerHas('chat/src/reactive/bad.ts', 'L1-layer-edge'), 'chat UI imports must stay inside src/react');
    expect(layerHas('analytics/src/bad.ts', 'L1-layer-edge'), 'analytics domain peer must fail');
    // PARITY: the deprecated sqlite facade still cannot depend on its server peer.
    expect(layerHas('sqlite/package.json', 'L1-layer-edge'), 'sqlite server edge must fail');
    for (const file of ['cli/src/ok.ts', 'ui/src/ok.ts', 'user-management/src/react/ok.ts', 'chat/src/react/components/ok.tsx', 'chat/src/react/hooks/ok.ts', 'analytics/src/ok.ts', 'analytics/package.json']) {
      expect(!layers.some(v => v.file.endsWith(file)), `${file} listed exception must pass`);
    }
    expect(layers.some(v => v.file.endsWith('core/src/up.ts') && v.rule === 'L3-undeclared-edge'), 'undeclared source edge must fail');
    return failures;
  } finally { rmSync(root, { recursive: true, force: true }); }
}
