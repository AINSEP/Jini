import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createPluginRuntimeToolMetadata } from '../plugin-runtime.js';

/**
 * @file Characterization pin for the plugin-runtime registration declarations: the tool names, their
 * search vocabulary and their approval/risk markers are deep-compared against a snapshot recorded from
 * the unsplit implementation, so assembling the map from smaller groups cannot drop or soften one.
 */
const recorded = JSON.parse(readFileSync(new URL('./fixtures/plugin-runtime.metadata.json', import.meta.url), 'utf8')) as Record<string, unknown>;
const FIXTURE_SECRET = 'sk-fixture-secret-0001';
const metadata = createPluginRuntimeToolMetadata({ pluginKeyword: 'host-plugin' });
const asJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

describe('createPluginRuntimeToolMetadata pin', () => {
  it('registers exactly the recorded tool names with their recorded declarations', () => {
    expect(Object.keys(metadata)).toEqual(Object.keys(recorded));
    expect(asJson(metadata)).toEqual(recorded);
  });

  it('keeps every explicit risk marker, with no entry left to a default', () => {
    expect(Object.entries(metadata).map(([name, entry]) => [name, entry.approval.class, entry.approval.confirmation])).toEqual([
      ['plugin_source_create', 'edit', 'direct'],
      ['plugin_source_open', 'edit', 'direct'],
      ['plugin_source_list', 'read', 'direct'],
      ['plugin_source_read', 'read', 'direct'],
      ['plugin_source_write', 'edit', 'direct'],
      ['plugin_source_edit', 'edit', 'direct'],
      ['plugin_source_delete', 'delete', 'plan'],
      ['plugin_source_seal', 'edit', 'direct'],
      ['plugin_source_rollback', 'edit', 'direct'],
      ['plugins_install', 'edit', 'direct'],
      ['plugins_list', 'read', 'direct'],
      ['provider_status', 'read', 'direct'],
      ['plugins_set_enabled', 'escalation', 'plan'],
      ['plugins_uninstall', 'trash', 'plan'],
    ]);
    expect(metadata.plugins_set_enabled.approval).toEqual({ class: 'escalation', confirmation: 'plan', rule: 'plugin-enable' });
  });

  it('holds only declaration text, never a credential value', () => {
    expect(JSON.stringify(metadata)).not.toContain(FIXTURE_SECRET);
    for (const entry of Object.values(metadata)) {
      expect(Object.keys(entry).every((key) => ['title', 'summary', 'search', 'approval'].includes(key))).toBe(true);
    }
  });
});
