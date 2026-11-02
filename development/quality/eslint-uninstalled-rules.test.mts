import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { expect, it } from 'vitest';

it('can lint useConversation with the installed rule set without undefined-rule errors', async () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const eslint = new ESLint({ cwd: root });
  expect(await eslint.isPathIgnored('packages/chat/src/react/hooks/useConversation.ts')).toBe(false);
  const results = await eslint.lintFiles(['packages/chat/src/react/hooks/useConversation.ts']);
  expect(results).toHaveLength(1);
  // Check actual diagnostics: a source-text ban would miss aliases and config changes.
  expect(results.flatMap(result => result.messages).filter(message =>
    message.fatal || /Definition for rule .* was not found/.test(message.message))).toEqual([]);
}, 30_000);
