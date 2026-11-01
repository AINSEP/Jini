import { describe, expect, it } from 'vitest';
import { toolPresentation } from '../tool-presentation.js';
import { AGY_DIRECT, AGY_READ } from './fixtures/cli-tool-events.js';

describe('CLI presentation boundary', () => {
  it.each([undefined, null, 'invalid', [], {}, { ServerName: '', ToolName: 'search_tools' },
    { ServerName: 'jini' }, { ToolName: 'search_tools' }, { ServerName: 42, ToolName: 'search_tools' },
    { ServerName: 'jini', ToolName: '' }])('leaves incomplete wrapper input untouched: %j', input => {
    const call = { name: 'call_mcp_tool', input };
    expect(toolPresentation(call)).toBe(call);
  });

  it.each(['Read', 'read_file', 'CustomTool', 'mcp__host__read_file', 'theme_read_file'])('preserves standard %s arguments', name => {
    const call = { name, input: { file_path: 'index.html' } };
    expect(toolPresentation(call)).toBe(call);
  });

  it('returns a generic inner-call contract without rewriting the saved wrapper', () => {
    const before = JSON.stringify(AGY_DIRECT);
    Object.freeze(AGY_DIRECT.input);
    const presentation = toolPresentation(AGY_DIRECT);
    expect(presentation).toEqual({ name: 'theme_read_file', input: { path: 'render/pages/index.html', themeId: 'tovu-starter' },
      wrapper: { name: 'theme_read_file', input: { path: 'render/pages/index.html', themeId: 'tovu-starter' } } });
    expect(JSON.stringify(AGY_DIRECT)).toBe(before);
  });

  it('adds the canonical file argument in the adapter only, preserving Path in history', () => {
    const before = JSON.stringify(AGY_READ);
    Object.freeze(AGY_READ.input);
    expect(toolPresentation(AGY_READ).input).toEqual({
      Path: '/Users/owner/.gemini/antigravity-cli/mcp/jini/search_tools.json',
      file_path: '/Users/owner/.gemini/antigravity-cli/mcp/jini/search_tools.json',
    });
    expect(JSON.stringify(AGY_READ)).toBe(before);
  });
});
