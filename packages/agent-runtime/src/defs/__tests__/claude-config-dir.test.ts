import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { resolveSourceClaudeConfigDir, stageClaudeConfigDir } from '../claude/config-dir.js';

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

describe('stageClaudeConfigDir', () => {
  it('stages only portable credentials and removes the scratch directory without touching the operator files', async () => {
    const source = await mkdtemp(path.join(os.tmpdir(), 'claude-config-source-'));
    const credentials = '{"oauth":{"accessToken":"fixture"}}';
    try {
      await writeFile(path.join(source, '.credentials.json'), credentials);
      await writeFile(path.join(source, 'settings.json'), '{"hooks":{"fixture":true}}');
      await mkdir(path.join(source, 'skills'));
      const staged = await stageClaudeConfigDir({ runId: '../run/blue', hostEnv: { CLAUDE_CONFIG_DIR: source } });
      try {
        expect(path.basename(staged.path)).toMatch(/^jini-claude-config----run-blue-/);
        expect(await readdir(staged.path)).toEqual(['.credentials.json']);
        expect(await readFile(path.join(staged.path, '.credentials.json'), 'utf8')).toBe(credentials);
      } finally {
        await staged.cleanup();
      }
      await staged.cleanup();
      await expect(readdir(staged.path)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await readFile(path.join(source, '.credentials.json'), 'utf8')).toBe(credentials);
      expect(await readFile(path.join(source, 'settings.json'), 'utf8')).toBe('{"hooks":{"fixture":true}}');
    } finally {
      await rm(source, { force: true, recursive: true });
    }
  });

  it('starts with an empty private directory when there is no file-based login', async () => {
    const source = await mkdtemp(path.join(os.tmpdir(), 'claude-config-uncredentialed-'));
    try {
      const staged = await stageClaudeConfigDir({ runId: '', hostEnv: { CLAUDE_CONFIG_DIR: source } });
      try {
        expect(path.basename(staged.path)).toMatch(/^jini-claude-config-run-/);
        expect(await readdir(staged.path)).toEqual([]);
      } finally {
        await staged.cleanup();
      }
    } finally {
      await rm(source, { force: true, recursive: true });
    }
  });

  it('reports the credential write error even if releasing the partial stage also fails', async () => {
    const writeError = new Error('scratch quota exhausted');
    const readFile = vi.fn(async () => '{"login":"fixture"}');
    const mkdtemp = vi.fn(async () => '/scratch/owned-run');
    const writeFile = vi.fn(async () => { throw writeError; });
    const removeDir = vi.fn(async () => { throw new Error('cleanup unavailable'); });

    await expect(stageClaudeConfigDir({ runId: 'red', hostEnv: { CLAUDE_CONFIG_DIR: '/operator/claude' } },
      { seams: { mkdtemp, readFile, writeFile, removeDir } })).rejects.toBe(writeError);
    expect(mkdtemp.mock.calls).toEqual([[{ prefix: 'jini-claude-config-red-' }]]);
    expect(readFile.mock.calls).toEqual([[{ path: path.join('/operator/claude', '.credentials.json') }]]);
    expect(writeFile.mock.calls).toEqual([[{ path: path.join('/scratch/owned-run', '.credentials.json'), content: '{"login":"fixture"}' }]]);
    expect(removeDir.mock.calls).toEqual([[{ path: '/scratch/owned-run' }]]);
  });
});
