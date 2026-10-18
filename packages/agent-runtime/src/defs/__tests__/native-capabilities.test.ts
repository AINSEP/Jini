import { describe, expect, it } from 'vitest';
import { claudeAgentDef } from '../claude.js';
import { codexAgentDef } from '../codex.js';

describe('per-run native capability overrides', () => {
  it('retains an explicit shell/file deny even when the other capabilities are granted', () => {
    const args = claudeAgentDef.buildArgs({ prompt: '', imagePaths: [] }, { options: {
      nativeToolAccess: true, cliParity: true, permissionMode: 'bypass',
      nativeCapabilities: { shell: false, fileWrite: false }, disallowedTools: ['Read(/secret)'],
    } });
    for (const tool of ['Bash', 'Edit', 'Write', 'Read(/secret)']) expect(args).toContain(tool);
  });
  it('isolates personal MCP independently of shell access and staged host tools', () => {
    const args = claudeAgentDef.buildArgs({ prompt: '', imagePaths: [] }, { options: {
      nativeToolAccess: true, cliParity: true, permissionMode: 'bypass', nativeCapabilities: { userMcp: false },
    }, runtimeContext: { mcpJsonPath: '/run/mcp.json' } });
    expect(args).toContain('--strict-mcp-config');
    expect(args).toContain('/run/mcp.json');
  });
  it('disables subagents, web and workflows independently', () => {
    const args = claudeAgentDef.buildArgs({ prompt: '', imagePaths: [] }, { options: {
      nativeToolAccess: true, nativeCapabilities: { subagents: false, web: false, workflows: false },
    } });
    for (const tool of ['Task', 'Agent', 'WebFetch', 'WebSearch', 'CronCreate', 'Workflow']) expect(args).toContain(tool);
    expect(args).not.toContain('Bash');
  });
  it.each([undefined, 'thread'])('enforces Codex restrictions on create and resume (%s)', resumeSessionId => {
    const args = codexAgentDef.buildArgs({ prompt: '', imagePaths: [] }, { options: {
      nativeToolAccess: true, cliParity: true, permissionMode: 'bypass',
      nativeCapabilities: { shell: false, fileWrite: false, subagents: false, web: false },
    }, runtimeContext: resumeSessionId === undefined ? {} : { resumeSessionId } });
    for (const override of ['features.shell_tool=false', 'features.unified_exec=false', 'sandbox_mode="read-only"',
      'features.multi_agent=false', 'web_search="disabled"']) expect(args).toContain(override);
  });
});
