import { expect, test, vi } from 'vitest';
import { createHookRegistry, PluginHookFailedError } from '../../hook-registry.js';
import { pluginSdkBinding } from '../support/fixture-bindings.js';

test('non-Error plugin and quarantine faults remain fail-closed, and reattachment clears every workspace quarantine', async () => {
  const onQuarantine = vi.fn(async () => { throw 'persistence refused'; });
  const registry = createHookRegistry({ pluginSdkBinding }, { failureThreshold: 1, onQuarantine });
  const declaredFields = [{ path: 'ext.sample.count', type: 'integer' as const }];
  registry.attach({ pluginId: 'sample', source: 'site', declaredFields, filter: () => { throw 'plugin refused'; } });
  for (const workspaceId of ['first', 'second']) {
    const result = registry.runBeforeSave({ entry: { workspaceId, ext: {} } });
    await expect(result).rejects.toBeInstanceOf(PluginHookFailedError);
    await expect(result).rejects.toThrow('plugin refused; automatic quarantine persistence failed: persistence refused');
    expect(await registry.previewBeforeSave({ pluginId: 'sample', entry: { workspaceId, ext: {} } })).toBeNull();
  }
  expect(onQuarantine).toHaveBeenCalledTimes(2);
  registry.detach({ pluginId: 'sample' });
  registry.attach({ pluginId: 'sample', source: 'site', declaredFields, filter: () => ({ count: 1 }) });
  for (const workspaceId of ['first', 'second']) {
    expect(await registry.runBeforeSave({ entry: { workspaceId, ext: {} } })).toEqual({ sample: { count: 1 } });
  }
  expect(onQuarantine).toHaveBeenCalledTimes(2);
});
