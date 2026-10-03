import { Command } from 'commander';
import { expect, it } from 'vitest';
import { CommandRegistry } from '../command-registry.js';
import { introspectProgram, toMcpTools } from '../introspection.js';

it('excludes meta names only at the root and keeps identically named nested capabilities', () => {
  const program = new Command('example');
  program.command('help').command('hidden');
  program.command('introspect');
  const group = program.command('group');
  group.command('help');
  group.command('introspect');
  group.command('nested').command('help');

  const manifest = introspectProgram({ program, excludedCommands: ['help', 'introspect'] });
  expect(manifest.commands.map(command => command.name)).toEqual([
    'group help', 'group introspect', 'group nested help',
  ]);
  expect(toMcpTools({ manifest, toolNamePrefix: 'example_' }).map(tool => tool.name)).toEqual([
    'example_group_help', 'example_group_introspect', 'example_group_nested_help',
  ]);
});

it('looks up registration and usage through the required name object', () => {
  const registry = new CommandRegistry({});
  expect(registry.has({ name: 'run' })).toBe(false);
  expect(registry.usageFor({ name: 'run' })).toBeUndefined();
  registry.add({ name: 'run', handler: () => {} }, { usage: 'run <task>' });
  expect(registry.has({ name: 'run' })).toBe(true);
  expect(registry.usageFor({ name: 'run' })).toBe('run <task>');
  expect(registry.has({ name: 'other' })).toBe(false);
  expect(registry.usageFor({ name: 'other' })).toBeUndefined();
});
