import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { isMcpManifest, isPluginManifest, PLUGIN_SKILLS_DIRNAME } from '../manifest.js';

describe('isPluginManifest', () => {
  it('accepts a manifest with a non-empty name', () => {
    expect(isPluginManifest({ name: 'design' })).toBe(true);
    expect(isPluginManifest({ $schema: 'https://example.com/schema.json', name: 'design' })).toBe(true);
  });

  it('rejects non-objects, missing name, and blank name', () => {
    expect(isPluginManifest(null)).toBe(false);
    expect(isPluginManifest(undefined)).toBe(false);
    expect(isPluginManifest('design')).toBe(false);
    expect(isPluginManifest({})).toBe(false);
    expect(isPluginManifest({ name: '' })).toBe(false);
    expect(isPluginManifest({ name: '   ' })).toBe(false);
    expect(isPluginManifest({ name: 42 })).toBe(false);
  });
});

describe('isMcpManifest', () => {
  it('accepts an mcpServers object, empty or populated', () => {
    expect(isMcpManifest({ mcpServers: {} })).toBe(true);
    expect(
      isMcpManifest({ mcpServers: { local: { type: 'stdio', command: './bin/tool' } } }),
    ).toBe(true);
  });

  it('rejects a missing or non-object mcpServers', () => {
    expect(isMcpManifest(null)).toBe(false);
    expect(isMcpManifest({})).toBe(false);
    expect(isMcpManifest({ mcpServers: [] })).toBe(false);
    expect(isMcpManifest({ mcpServers: 'nope' })).toBe(false);
  });
});

describe('samples/design plugin', () => {
  const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const pluginRoot = join(packageRoot, 'samples', 'design');

  it('has a plugin.json that validates as a PluginManifest', () => {
    const manifest: unknown = JSON.parse(readFileSync(join(pluginRoot, 'plugin.json'), 'utf8'));
    expect(isPluginManifest(manifest)).toBe(true);
    expect((manifest as { name: string }).name).toBe('design');
  });

  it('bundles a skill directory per Web-Design-owned AI-Dev-Shop skill', () => {
    const skillDirs = readdirSync(join(pluginRoot, PLUGIN_SKILLS_DIRNAME)).sort();
    expect(skillDirs).toEqual([
      'frontend-accessibility',
      'gstack-design',
      'interface-design',
      'premium-ui',
      'shadcn-ui',
      'ux-design',
      'vercel-web-design-guidelines',
      'web-compliance',
    ]);
  });

  it('every bundled skill carries a SKILL.md', () => {
    const skillDirs = readdirSync(join(pluginRoot, PLUGIN_SKILLS_DIRNAME));
    for (const dir of skillDirs) {
      const files = readdirSync(join(pluginRoot, PLUGIN_SKILLS_DIRNAME, dir));
      expect(files).toContain('SKILL.md');
    }
  });

  it('has an mcp.json that validates as an McpManifest (empty — example only)', () => {
    const manifest: unknown = JSON.parse(readFileSync(join(pluginRoot, 'mcp.json'), 'utf8'));
    expect(isMcpManifest(manifest)).toBe(true);
    expect((manifest as { mcpServers: Record<string, unknown> }).mcpServers).toEqual({});
  });

  it('has a client extension directory (§8.2) with valid-JSON, client-defined content', () => {
    // Only asserting the file parses — Agent Plugins assigns no portable semantics to what's
    // inside a client's own namespace directory, so there is no shape to validate against.
    const raw = readFileSync(join(pluginRoot, 'com.anthropic.claude-code', 'hooks', 'hooks.json'), 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });
});
