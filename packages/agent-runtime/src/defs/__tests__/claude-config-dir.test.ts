import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveSourceClaudeConfigDir } from '../claude/config-dir.js';

describe('resolveSourceClaudeConfigDir', () => {
  it('uses hostEnv.CLAUDE_CONFIG_DIR when set to a non-blank value', () => {
    expect(resolveSourceClaudeConfigDir({ hostEnv: { CLAUDE_CONFIG_DIR: '/custom/claude-config' } })).toBe('/custom/claude-config');
  });

  it('falls back to ~/.claude when CLAUDE_CONFIG_DIR is unset', () => {
    expect(resolveSourceClaudeConfigDir({ hostEnv: {} })).toBe(path.join(os.homedir(), '.claude'));
  });

  it('treats a blank/whitespace-only CLAUDE_CONFIG_DIR the same as unset', () => {
    expect(resolveSourceClaudeConfigDir({ hostEnv: { CLAUDE_CONFIG_DIR: '   ' } })).toBe(path.join(os.homedir(), '.claude'));
  });
});
