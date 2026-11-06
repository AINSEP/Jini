import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { expect, it } from 'vitest';

it('can lint authored React sources with the installed rules without undefined-rule errors', async () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const eslint = new ESLint({ cwd: root });
  const files = [
    'packages/chat/src/react/hooks/useConversation.ts',
    'packages/chat/src/react/components/MessageList.hooks.ts',
    'packages/ui/src/features/memory/react/render-markdown.tsx',
    'packages/provider-plugins/src/charts-echarts/mount.ts',
  ];
  for (const file of files) expect(await eslint.isPathIgnored(file)).toBe(false);
  const results = await eslint.lintFiles(files);
  expect(results).toHaveLength(files.length);
  // Check actual diagnostics: a source-text ban would miss aliases and config changes.
  expect(results.flatMap(result => result.messages).filter(message =>
    message.fatal || /Definition for rule .* was not found/.test(message.message))).toEqual([]);
}, 30_000);

it('ignores generated provider payloads while keeping authored provider source checked', async () => {
  const eslint = new ESLint({ cwd: fileURLToPath(new URL('../../', import.meta.url)) });
  expect(await eslint.isPathIgnored('packages/provider-plugins/plugins/generated/index.js')).toBe(true);
  expect(await eslint.isPathIgnored('packages/provider-plugins/src/charts-echarts/mount.ts')).toBe(false);
  const [result] = await eslint.lintText('export const branches = (a, b) => { if (a) { if (b) return 1; } return 0; };', {
    filePath: 'packages/provider-plugins/src/authored.ts',
  });
  expect(result.messages.some(message => message.ruleId?.startsWith('sonarjs/'))).toBe(true);
});

it('lints authored coverage tooling while excluding generated coverage reports', async () => {
  const eslint = new ESLint({ cwd: fileURLToPath(new URL('../../', import.meta.url)) });
  expect(await eslint.isPathIgnored('packages/devops/src/checks/coverage/lcov.ts')).toBe(false);
  expect(await eslint.isPathIgnored('packages/devops/coverage/report.ts')).toBe(true);
});
