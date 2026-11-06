import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { expect, it } from 'vitest';

const options = {
  cwd: fileURLToPath(new URL('../../', import.meta.url)),
  overrideConfigFile: fileURLToPath(new URL('../../development/quality/eslint.sonar.config.mjs', import.meta.url)),
};

it('does not activate unavailable rules from copied directives in generated payloads', async () => {
  const eslint = new ESLint(options);
  const filePath = 'packages/provider-plugins/plugins/generated/server/index.mjs';
  expect(await eslint.isPathIgnored(filePath)).toBe(false);
  const [result] = await eslint.lintText([
    '/* eslint-disable @typescript-eslint/no-explicit-any */',
    '/* eslint-enable @typescript-eslint/unified-signatures */',
    'export const ready = true;',
  ].join('\n'), { filePath });

  expect(result).toBeDefined();
  expect(result!.errorCount).toBe(0);
  expect(result!.fatalErrorCount).toBe(0);
  expect(result!.messages.filter(message => /Definition for rule .* was not found/.test(message.message))).toEqual([]);
});

it('does not let authored source suppress a standalone Sonar finding', async () => {
  const [result] = await new ESLint(options).lintText([
    '// eslint-disable-next-line sonarjs/no-identical-expressions',
    'export const same = (value: boolean) => value && value;',
  ].join('\n'), { filePath: 'packages/core/src/inline-directive-probe.ts' });

  expect(result).toBeDefined();
  expect(result!.messages).toEqual(expect.arrayContaining([
    expect.objectContaining({ ruleId: 'sonarjs/no-identical-expressions', severity: 1 }),
  ]));
});
