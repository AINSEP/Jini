import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (file: string) => readFileSync(new URL('../../' + file, import.meta.url), 'utf8');
const originalUi = execFileSync('git', ['show', '35c4961af718f0f30591c46d2ea2756c4484a731:packages/ui/package.json'], { cwd: root, encoding: 'utf8' });
const optionalPeers = (source: string) => source.match(/"optionalPeers": \{[\s\S]*?\n    \}/)?.[0];

it('F3 A2 changeset records both public minor releases and compatible parser injection', () => {
  const changeset = read('.changeset/extract-s3-a2-mail-compatibility.md');
  expect(changeset).toContain('"@jini-ai/platform": minor');
  expect(changeset).toContain('"@jini-ai/agent-plugins": minor');
  for (const name of ['toPluginHttpClient', 'fromPositionalMailer', 'toPositionalMailer', 'createProviderMailer', 'createMailContributions', 'createMailCatalog', 'createMailConfiguration', 'createMailSelection', 'createHostMailer', 'parseSetup', 'raw-only']) expect(changeset).toContain(name);
});

it('F4 mail registry comments explain stable ordering and log-safe refusal custody at their members', () => {
  const source = read('packages/agent-plugins/src/lifecycle/mail/contribution.ts');
  expect(source).toContain('/** Every loaded adapter, in a stable order (plugin id, then declaration order). */\n  list()');
  expect(source).toContain('/** Log-safe, one sentence per plugin or adapter that was NOT loaded, and why. */\n  readonly refusals:');
});

it('F4 credential-card production code retains the complete redirect-prevention rationale', () => {
  const rationale = `/**
 * @file A key card an installed plugin declares for its own provider (2026-10-22, starting with mail
 * providers). The generic "Save an API credential" card asks for a label, base URL, category and
 * deploy targets the person has no reason to know; a plugin that already knows them declares its own
 * card copy, and core fills the rest in on the server. The form carries a masked token plus
 * declared non-secret fields. Fixed labels, origins and categories remain server-owned, so a
 * submission cannot redirect the key to another row. Instance-specific origins are explicit fields. Core names no vendor: every word on the card comes from the plugin's descriptor.
 */`;
  expect(read('packages/ui/src/features/mcp-ui/credential-card.ts')).toContain(rationale);
});

it('F4 provider status privacy rationale is at file scope before the factory', () => {
  const source = read('packages/agent-plugins/src/lifecycle/host-tools/provider-status-tool.ts');
  expect(source.indexOf('@file')).toBeLessThan(source.indexOf('export function createProviderStatusTools'));
  expect(source).toContain('Never a setting value: hosts and endpoints can carry private tenant URLs, and secrets never leave');
});

it('F5 checker collects every import through one live collection branch', () => {
  const source = read('scripts/check-no-cross-package.ts');
  const body = source.slice(source.indexOf('function collectImport'), source.indexOf('function forbidden'));
  expect(body.match(/specs\.add\(node\.moduleSpecifier\.text\)/g)).toHaveLength(1);
});

it('F5 UI optional-peer strings preserve the original em-dash formatting exactly', () => {
  expect(Object.keys(JSON.parse(originalUi).jini.optionalPeers)).toHaveLength(18);
  expect(optionalPeers(read('packages/ui/package.json'))).toBe(optionalPeers(originalUi));
});
