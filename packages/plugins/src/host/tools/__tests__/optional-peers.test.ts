import { spawnSync } from 'node:child_process';
import { expect, test } from 'vitest';
import { PluginInstallError, PluginSourceError } from '@jini-ai/plugins/host/tools';
import { PluginInstallError as NodeInstallError, PluginSourceError as NodeSourceError } from '@jini-ai/plugins/host/node';

test('the published tool entry imports without platform or semver', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', `
    import { registerHooks } from 'node:module';
    registerHooks({ resolve(specifier, context, nextResolve) {
      if (specifier === 'semver' || specifier.startsWith('@jini-ai/platform')) {
        throw new Error('Unexpected optional peer: ' + specifier);
      }
      return nextResolve(specifier, context);
    } });
    const entry = await import('@jini-ai/plugins/host/tools');
    if (typeof entry.buildPluginManagementRegistrations !== 'function') throw new Error('Missing management tools');
  `], { encoding: 'utf8' });
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
});

test('portable and filesystem entries retain the same canonical refusal classes', () => {
  expect(PluginInstallError).toBe(NodeInstallError);
  expect(PluginSourceError).toBe(NodeSourceError);
  expect(new NodeInstallError('REFUSED', 'install refusal')).toBeInstanceOf(PluginInstallError);
  expect(new NodeSourceError('REFUSED', 'source refusal')).toBeInstanceOf(PluginSourceError);
});
