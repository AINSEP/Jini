import { execSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { prepareClaudeSubagentStartSettings } from '../subagent-start.js';

const scratch = await mkdtemp(join(tmpdir(), 'jini-subagent-start-'));
afterAll(() => rm(scratch, { recursive: true, force: true }));

it.each(["posix owner's directory", "Users\\Fixture Owner\\quoted 'run'"])('replays the complete frozen snapshot with path %s', async directoryName => {
  const nativeDirectory = join(scratch, directoryName);
  const directory = directoryName.startsWith('posix') ? nativeDirectory.replaceAll('\\', '/') : nativeDirectory;
  await mkdir(directory, { recursive: true });
  const source = join(directory, 'guidance.md');
  const snapshot = `BEGIN\n${'guidance '.repeat(1200)}\nEND`;
  await writeFile(source, snapshot);
  const priorHook = { hooks: [{ type: 'command', command: 'existing-hook' }] };
  const settings = JSON.stringify({ autoMemoryEnabled: false, permissions: { deny: ['Read(/private/**)'] }, sandbox: { enabled: true }, hooks: { PreToolUse: [priorHook], SubagentStart: [priorHook] } });
  const merged = JSON.parse(await prepareClaudeSubagentStartSettings({ directory, snapshot: await readFile(source, 'utf8'), settings }, {}));
  expect({ ...merged, hooks: { ...merged.hooks, SubagentStart: merged.hooks.SubagentStart.slice(0, 1) } }).toEqual(JSON.parse(settings));
  expect(merged.hooks.SubagentStart).toHaveLength(2);
  const hook = merged.hooks.SubagentStart[1];
  expect(hook).toMatchObject({ hooks: [{ type: 'command', timeout: 5 }] });
  await writeFile(source, 'changed after preflight');
  const output = execSync(hook.hooks[0].command, { input: JSON.stringify({ hook_event_name: 'SubagentStart', agent_type: 'fixture' }), encoding: 'utf8' });
  expect(JSON.parse(output)).toEqual({ hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: snapshot } });
  expect(output).toBe(await readFile(join(directory, 'subagent-start.json'), 'utf8'));
  expect(hook.hooks[0].command).not.toContain(directory);
  if (process.platform !== 'win32') expect((await stat(join(directory, 'subagent-start.json'))).mode & 0o777).toBe(0o600);
});

it('accepts exactly 64 KiB and refuses oversized UTF-8 snapshots without truncating', async () => {
  const directory = join(scratch, 'budget');
  await mkdir(directory);
  const snapshot = 'é'.repeat(32 * 1024);
  const settings = JSON.parse(await prepareClaudeSubagentStartSettings({ directory, snapshot }, {}));
  expect(JSON.parse(execSync(settings.hooks.SubagentStart[0].hooks[0].command, { encoding: 'utf8' })).hookSpecificOutput.additionalContext).toBe(snapshot);
  await expect(prepareClaudeSubagentStartSettings({ directory, snapshot: `${snapshot}é` }, {})).rejects.toThrow('64 KiB');
});

it('refuses to overwrite a snapshot and rejects invalid settings', async () => {
  const directory = join(scratch, 'exclusive');
  await mkdir(directory);
  await prepareClaudeSubagentStartSettings({ directory, snapshot: 'original' }, {});
  await expect(prepareClaudeSubagentStartSettings({ directory, snapshot: 'replacement' }, {})).rejects.toMatchObject({ code: 'EEXIST' });
  expect(JSON.parse(await readFile(join(directory, 'subagent-start.json'), 'utf8')).hookSpecificOutput.additionalContext).toBe('original');
  await expect(prepareClaudeSubagentStartSettings({ directory, snapshot: 'rules', settings: '{' }, {})).rejects.toThrow();
});
