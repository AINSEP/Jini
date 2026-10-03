import { existsSync, readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('chat package content', () => {
  // REGRESSION: fails if "!dist/react/poc-mcp-ui-official/**" is removed from files.
  it('excludes stale compiled MCP-UI proof-of-concept files from distribution', () => {
    const manifest = JSON.parse(readFileSync(new NodeURL('../../../package.json', import.meta.url), 'utf8'));
    expect(manifest.files).toContain('!dist/react/poc-mcp-ui-official/**');
  });

  // REGRESSION: fails if "!dist/react/features/model-picker/**" is removed from files.
  it('excludes stale compiled model-picker files from distribution', () => {
    const manifest = JSON.parse(readFileSync(new NodeURL('../../../package.json', import.meta.url), 'utf8'));
    expect(manifest.files).toContain('!dist/react/features/model-picker/**');
  });

  // REGRESSION: fails if src/react/poc-mcp-ui-official/create-poc-resource.ts is restored.
  it('contains no unused official MCP-UI proof of concept', () => {
    expect(existsSync(new NodeURL('../poc-mcp-ui-official/', import.meta.url))).toBe(false);
  });

  // REGRESSION: fails if src/react/features/model-picker/index.ts is restored.
  it('contains no unused internal model picker', () => {
    expect(existsSync(new NodeURL('../features/model-picker/', import.meta.url))).toBe(false);
  });

  // REGRESSION: fails if "@mcp-ui/client": "7.1.1" is restored to dependencies.
  it('does not install the official MCP-UI client directly', () => {
    const manifest = JSON.parse(readFileSync(new NodeURL('../../../package.json', import.meta.url), 'utf8'));
    expect(manifest.dependencies).not.toHaveProperty('@mcp-ui/client');
  });

  // REGRESSION: fails if "@mcp-ui/server": "6.1.0" is restored to dependencies.
  it('does not install the official MCP-UI resource builder directly', () => {
    const manifest = JSON.parse(readFileSync(new NodeURL('../../../package.json', import.meta.url), 'utf8'));
    expect(manifest.dependencies).not.toHaveProperty('@mcp-ui/server');
  });
});
