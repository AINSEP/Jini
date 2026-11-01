import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { claudeAgentDef } from '@jini-ai/agent-runtime';
import { buildAgentEnv } from '../agent-env.js';

it.skipIf(process.platform === 'win32')('Full CLI Bash launch contract preserves the site cwd and writable private TMPDIR for compound commands', () => {
  const root = mkdtempSync(join(process.cwd(), '.bash-launch-'));
  try {
    const site = realpathSync(root);
    const temp = join(site, '.agent-runtime', 'tmp-probe');
    mkdirSync(temp, { recursive: true });
    // Mirror the executor's two scratch channels. The short Claude base is only inspected here:
    // this probe does not claim to run Claude's OS sandbox or create files outside this fixture.
    const claudeTemp = '/var/tmp/jini-PROBE1';
    const env = { ...buildAgentEnv({ hostEnv: { PATH: '/usr/bin:/bin', HOME: homedir(), TMPDIR: '/tmp' } }),
      TMPDIR: temp, TMP: temp, TEMP: temp, CLAUDE_CODE_TMPDIR: claudeTemp };
    const args = claudeAgentDef.buildArgs({ prompt: 'probe', imagePaths: [] }, { runtimeContext: { cwd: site }, options: {
      filesystemRoot: site, filesystemTempDir: temp, filesystemRuntimeTempBase: claudeTemp,
      filesystemSharedTempRoots: ['/tmp'], nativeToolAccess: true, permissionMode: 'bypass', cliParity: true,
      nativeCapabilities: { shell: true, fileWrite: true, userSettings: true },
    } });
    const settings = JSON.parse(args[args.indexOf('--settings') + 1]!);
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('bypassPermissions');
    expect(args).not.toContain('--tools');
    expect(settings.sandbox).toMatchObject({ enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false });
    const scratch = join(claudeTemp, `claude-${process.getuid!()}`);
    expect(settings.sandbox.filesystem.allowRead).toEqual(expect.arrayContaining([site, temp, scratch]));
    expect(settings.sandbox.filesystem.allowWrite).toEqual(expect.arrayContaining([site, temp, scratch]));
    expect(settings.sandbox.filesystem.allowWrite).not.toContain('/tmp');
    expect(Buffer.byteLength(scratch)).toBeLessThanOrEqual(44);
    const child = spawnSync('/bin/bash', ['--noprofile', '--norc', '-c',
      'pwd -P && printf REPRO_OK > "$TMPDIR/probe" && cat "$TMPDIR/probe"'], {
      cwd: site, env, encoding: 'utf8', timeout: 5000,
    });
    expect(child.error).toBeUndefined();
    expect(child.status).toBe(0);
    expect(child.stderr).toBe('');
    expect(child.stdout).toBe(`${site}\nREPRO_OK`);
    expect(readFileSync(join(temp, 'probe'), 'utf8')).toBe('REPRO_OK');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
