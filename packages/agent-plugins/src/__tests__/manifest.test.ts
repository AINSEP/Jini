import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { isMcpManifest, isPluginManifest, PLUGIN_SKILLS_DIRNAME } from '../manifest.js';
import { parseAgentPluginManifest } from '../lifecycle/manifest.js';

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

describe('ui-ux-design plugin', () => {
  const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const pluginRoot = join(packageRoot, 'ui-ux-design');

  it('has a plugin.json that validates as a PluginManifest', () => {
    const manifest: unknown = JSON.parse(readFileSync(join(pluginRoot, 'plugin.json'), 'utf8'));
    expect(isPluginManifest(manifest)).toBe(true);
    expect((manifest as { name: string }).name).toBe('ui-ux-design');
    expect((manifest as { version: string }).version).toBe('0.6.1');
  });

  it('bundles a skill directory per Web-Design-owned AI-Dev-Shop skill', () => {
    const skillDirs = readdirSync(join(pluginRoot, PLUGIN_SKILLS_DIRNAME)).sort();
    expect(skillDirs).toEqual([
      'frontend-accessibility',
      'gstack-design',
      'interface-design',
      'shadcn-ui',
      'ui-ux-design',
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

describe('slide-design plugin', () => {
  const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const pluginRoot = join(packageRoot, 'slide-design');
  const skillRoot = join(pluginRoot, PLUGIN_SKILLS_DIRNAME, 'slide-design');
  const skill = readFileSync(join(skillRoot, 'SKILL.md'), 'utf8');
  const references = readdirSync(join(skillRoot, 'references')).sort();

  it('has a plugin.json the strict parser accepts, with its publisher id and capability', () => {
    const parsed = parseAgentPluginManifest({ value: JSON.parse(readFileSync(join(pluginRoot, 'plugin.json'), 'utf8')) });
    if (!parsed.ok) throw new Error(parsed.errors.join('; '));
    expect(parsed.manifest).toMatchObject({ name: 'slide-design', id: 'jini/slide-design', provides: ['slide-design'], version: '0.1.0', license: 'Apache-2.0' });
  });

  it('bundles exactly one skill whose frontmatter names it', () => {
    expect(readdirSync(join(pluginRoot, PLUGIN_SKILLS_DIRNAME))).toEqual(['slide-design']);
    expect(skill).toMatch(/^---\nname: slide-design\n[\s\S]*?\ndescription: Use when \S[^\n]+\n---\n/);
  });

  it('names every reference file it ships, and ships every reference it names', () => {
    expect(references).toEqual(['charts-and-exhibits.md', 'html-deck.md', 'layout-and-style.md', 'review.md', 'storyline.md']);
    const named = [...new Set([...skill.matchAll(/references\/([a-z-]+\.md)/g)].map(match => match[1]))].sort();
    expect(named).toEqual(references);
  });

  it('keeps its text consumer-neutral', () => {
    for (const text of [skill, ...references.map(name => readFileSync(join(skillRoot, 'references', name), 'utf8'))]) {
      expect(text).not.toMatch(/tovu|\boria\b/i);
    }
  });

  it('has an mcp.json that validates as an empty McpManifest', () => {
    const manifest: unknown = JSON.parse(readFileSync(join(pluginRoot, 'mcp.json'), 'utf8'));
    expect(isMcpManifest(manifest)).toBe(true);
    expect((manifest as { mcpServers: Record<string, unknown> }).mcpServers).toEqual({});
  });

  it('has a client extension directory (§8.2) with valid JSON', () => {
    const raw = readFileSync(join(pluginRoot, 'com.anthropic.claude-code', 'hooks', 'hooks.json'), 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });
});
