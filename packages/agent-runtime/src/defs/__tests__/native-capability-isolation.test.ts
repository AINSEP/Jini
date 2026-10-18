import { describe, expect, it } from 'vitest';
import type { NativeCapabilities } from '../../native-tool-policy.js';
import { claudeAgentDef } from '../claude.js';
import { codexAgentDef } from '../codex.js';

const allOn: NativeCapabilities = {
  shell: true, fileWrite: true, userMcp: true, subagents: true,
  userSettings: true, web: true, workflows: true, loginEnvironment: true,
};
// A5: each row turns only one switch OFF. A broad all-OFF implementation must fail.
const cases: { key: keyof NativeCapabilities; claude: string[]; codex: string[] }[] = [
  { key: 'shell', claude: ['Bash', 'BashOutput', 'KillShell'], codex: ['features.shell_tool=false', 'features.unified_exec=false', 'features.code_mode=false'] },
  { key: 'fileWrite', claude: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'], codex: ['features.apply_patch_freeform=false'] },
  { key: 'subagents', claude: ['Task', 'Agent'], codex: ['features.multi_agent=false', 'features.collab=false'] },
  { key: 'web', claude: ['WebFetch', 'WebSearch'], codex: ['web_search="disabled"'] },
  { key: 'workflows', claude: ['CronCreate', 'CronDelete', 'CronList', 'EnterWorktree', 'ExitWorktree', 'RemoteTrigger', 'Workflow'], codex: ['features.worktrees=false', 'features.remote_control=false'] },
  { key: 'userSettings', claude: [], codex: ['features.skills=false', 'features.plugins=false'] },
  // MCP home staging and the host's login-env port enforce these dimensions outside Codex argv.
  { key: 'userMcp', claude: [], codex: [] },
  { key: 'loginEnvironment', claude: [], codex: [] },
];

describe('A5: isolated native permissions in the actual provider argument builders', () => {
  for (const { key, claude, codex } of cases) {
    it(`Claude ${key} OFF preserves every other capability and the staged host bridge`, () => {
      const args = claudeAgentDef.buildArgs({ prompt: '', imagePaths: [] }, {
        options: { nativeToolAccess: true, cliParity: true, permissionMode: 'bypass',
          capabilities: {}, nativeCapabilities: { ...allOn, [key]: false }, disallowedTools: ['Read(/secret)'] },
        runtimeContext: { mcpJsonPath: '/run/host-bridge.json' },
      });
      expect(args).toEqual([
        '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
        '--permission-mode', 'bypassPermissions',
        ...(key === 'userMcp' ? ['--strict-mcp-config'] : []), '--mcp-config', '/run/host-bridge.json',
        '--disallowedTools', 'Read(/secret)', ...claude,
        ...(key === 'userSettings' ? ['--setting-sources', '', '--disable-slash-commands'] : []),
      ]);
    });

    for (const resume of [false, true]) {
      it(`Codex ${key} OFF changes only its own policy on ${resume ? 'resume' : 'create'}`, () => {
        const args = codexAgentDef.buildArgs({ prompt: '', imagePaths: [] }, {
          options: { nativeToolAccess: true, cliParity: true, permissionMode: 'bypass', nativeCapabilities: { ...allOn, [key]: false } },
          runtimeContext: resume ? { resumeSessionId: 'saved-thread' } : {},
        });
        expect(args).toEqual([
          'exec', ...(resume ? ['resume'] : []), '--json', '--skip-git-repo-check',
          ...(key === 'fileWrite' ? ['-c', 'sandbox_mode="read-only"'] : resume
            ? ['-c', 'sandbox_mode="danger-full-access"'] : ['--sandbox', 'danger-full-access']),
          '-c', 'approval_policy="never"', ...codex.flatMap(value => ['-c', value]),
          ...(resume ? ['saved-thread'] : []),
        ]);
      });
    }
  }
});
