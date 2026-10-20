/**
 * @file Unit tests for the tool contribution definition: it is an executable definition on the
 * host-chosen filename, imports exactly the declared module, and refuses a module export that is
 * not a tool module, naming the tool and plugin. The import port is a typed fake; nothing runs.
 */
import { describe, expect, test } from 'vitest';
import type { PluginModuleImportPort } from '../../contribution-loader.js';
import type { TrustedPluginPackage } from '../../trusted-plugin-files.js';
import { defineAgentPluginToolContribution } from '../definition.js';
import type { AgentPluginToolDescriptor } from '../manifest.js';

const PLUGIN: TrustedPluginPackage = { pluginId: 'acme-office', packageRoot: '/plugins/acme-office' };
const DESCRIPTOR: AgentPluginToolDescriptor = { name: 'list_rows', description: 'Lists rows.', effect: 'read', module: 'tools/list.mjs', inputSchema: { type: 'object' } };

function load(exported: unknown) {
  const requested: string[] = [];
  const importModule: PluginModuleImportPort = async ({ modulePath }) => { requested.push(modulePath); return { exported }; };
  const definition = defineAgentPluginToolContribution({ filename: 'host-agent-tools.json' });
  return { requested, loaded: definition.load({ plugin: PLUGIN, descriptor: DESCRIPTOR, importModule }) };
}

test('is an executable contribution on the host-chosen filename, parsed by the tools parser', () => {
  const definition = defineAgentPluginToolContribution({ filename: 'host-agent-tools.json' });
  expect(definition).toMatchObject({ filename: 'host-agent-tools.json', contribution: 'agent tools', kind: 'executable' });
  expect(definition.parse({ raw: '{}' })).toEqual({ ok: false, reason: 'schemaVersion must be 1' });
});

describe('module export validation', () => {
  test('a valid tool module loads, importing the declared module path', async () => {
    const module = { invoke: () => 'ok' };
    const { requested, loaded } = load(module);
    await expect(loaded).resolves.toEqual({ descriptor: DESCRIPTOR, pluginId: 'acme-office', module });
    expect(requested).toEqual(['tools/list.mjs']);
  });

  test('a module with a describeAffectedResources function loads', async () => {
    const module = { invoke: () => 'ok', describeAffectedResources: () => ['row 1'] };
    await expect(load(module).loaded).resolves.toMatchObject({ module });
  });

  test('a null export is refused, naming the tool and plugin', async () => {
    await expect(load(null).loaded).resolves.toBe("agent tool 'list_rows' from 'acme-office' was not loaded: its module's default export is not an object");
  });

  test('a function export is refused as not an object', async () => {
    await expect(load(() => 'ok').loaded).resolves.toBe("agent tool 'list_rows' from 'acme-office' was not loaded: its module's default export is not an object");
  });

  test('an export without invoke() is refused', async () => {
    await expect(load({ run: () => 'ok' }).loaded).resolves.toBe("agent tool 'list_rows' from 'acme-office' was not loaded: its module's default export has no invoke()");
  });

  test('a non-function describeAffectedResources is refused', async () => {
    await expect(load({ invoke: () => 'ok', describeAffectedResources: ['row 1'] }).loaded)
      .resolves.toBe("agent tool 'list_rows' from 'acme-office' was not loaded: describeAffectedResources must be a function");
  });
});
