import { describe, expect, it } from 'vitest';
import { resolveNativeToolDenies } from '../../native-tool-policy.js';
import { claudeAgentDef } from '../claude.js';
import { codexAgentDef } from '../codex.js';

describe('explicit native fallback grant', () => {
  it('lifts shell/edit denies only; path, scheduling and subagent denies survive', () => {
    const denied = ['Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'BashOutput', 'KillShell', 'Read(//**/.tovu/**)', 'Agent', 'CronCreate'];
    expect(resolveNativeToolDenies({ enabled: true, denied }, {})).toEqual(['Read(//**/.tovu/**)', 'Agent', 'CronCreate']);
    expect(denied).toContain('Bash');
    expect(resolveNativeToolDenies({ enabled: undefined, denied }, {})).toBe(denied);
    expect(resolveNativeToolDenies({ enabled: false }, {})).toContain('Bash');
  });
  it('Claude actually enforces both grants in argv', () => {
    const locked = claudeAgentDef.buildArgs({ prompt: 'hello', imagePaths: [] }, { options: { nativeToolAccess: false } });
    expect(locked).toContain('--disallowedTools');
    expect(locked).toContain('NotebookEdit');
    const granted = claudeAgentDef.buildArgs({ prompt: 'hello', imagePaths: [] }, { options: { nativeToolAccess: true, disallowedTools: ['Bash', 'Read(/secret)'] } });
    expect(granted).not.toContain('Bash');
    expect(granted).toContain('Read(/secret)');
  });
  it.each([undefined, 'existing-thread'])('Codex locks shells and file patches on create/resume (%s)', resumeSessionId => {
    const args = codexAgentDef.buildArgs({ prompt: 'hello', imagePaths: [] }, {
      options: { nativeToolAccess: false }, runtimeContext: resumeSessionId ? { resumeSessionId } : {},
    });
    expect(args).toContain('sandbox_mode="read-only"');
    expect(args).toContain('features.shell_tool=false');
    expect(args).toContain('features.unified_exec=false');
    expect(args).toContain('features.code_mode=false');
    expect(args).toContain('approval_policy="never"');
    expect(args).not.toContain('danger-full-access');
  });
  it('Codex grant keeps its existing workspace sandbox security boundary', () => {
    const args = codexAgentDef.buildArgs({ prompt: 'hello', imagePaths: [] }, { options: { nativeToolAccess: true } });
    expect(args).not.toContain('features.shell_tool=false');
  });
});

describe('trusted CLI parity vs explicit locked provider policy', () => {
  it('inherits user MCP servers only for a trusted bypass grant, keeping explicit bridge config', () => {
    const runtimeContext = { mcpJsonPath: '/run/bridge.json' };
    const granted = claudeAgentDef.buildArgs({ prompt: 'hello', imagePaths: [] }, { runtimeContext,
      options: { cliParity: true, permissionMode: 'bypass', nativeToolAccess: true } });
    expect(granted).toContain('--mcp-config'); expect(granted).toContain('/run/bridge.json');
    expect(granted).not.toContain('--strict-mcp-config');
    for (const permissionMode of ['bypass', 'restricted'] as const) {
      const locked = claudeAgentDef.buildArgs({ prompt: 'hello', imagePaths: [] }, { runtimeContext,
        options: { cliParity: true, permissionMode, nativeToolAccess: false,
          disallowedTools: ['Bash', 'Edit', 'Write', 'Task', 'Agent'] } });
      expect(locked).toContain('--strict-mcp-config');
      for (const tool of ['Bash', 'Edit', 'Write', 'Task', 'Agent']) expect(locked).toContain(tool);
    }
  });
  it.each([undefined, 'existing-thread'])('Codex grants danger-full-access for parity on create/resume (%s), with locks winning', resumeSessionId => {
    const runtimeContext = resumeSessionId ? { resumeSessionId } : {};
    const granted = codexAgentDef.buildArgs({ prompt: 'hello', imagePaths: [] }, { runtimeContext,
      options: { cliParity: true, permissionMode: 'bypass', nativeToolAccess: true } });
    expect(granted).toContain(resumeSessionId ? 'sandbox_mode="danger-full-access"' : 'danger-full-access');
    const locked = codexAgentDef.buildArgs({ prompt: 'hello', imagePaths: [] }, { runtimeContext,
      options: { cliParity: true, permissionMode: 'restricted', nativeToolAccess: false } });
    expect(locked).toContain('sandbox_mode="read-only"');
    expect(locked).toContain('features.shell_tool=false');
    expect(locked).toContain('features.multi_agent=false');
    expect(locked).not.toContain('sandbox_mode="danger-full-access"');
  });
});