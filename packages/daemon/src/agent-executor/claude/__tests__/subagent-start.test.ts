import { execSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { prepareClaudeSubagentStartSettings } from '../subagent-start.js';

const scratch = await mkdtemp(join(tmpdir(), 'jini-subagent-start-'));
afterAll(() => rm(scratch, { recursive: true, force: true }));
const context = { ids: ['ui-ux-design'], instructions: 'Before starting, call load_agent_plugin for every parent plugin and follow it. Discover tools with search_tools, describe before executing, honor approvals, and search files inside the site.' };

it.each(['linux', 'darwin', 'win32'] as const)('stages only a short pointer and preserves settings with %s path quoting', async platform => {
  const directory = join(scratch, `${platform} owner's 日本語 directory`);
  await mkdir(directory);
  await writeFile(join(directory, 'SKILL.md'), 'FULL_SKILL_TEXT'.repeat(1000));
  const priorHook = { hooks: [{ type: 'command', command: 'existing-hook' }] };
  const settings = JSON.stringify({ autoMemoryEnabled: false, permissions: { deny: ['Read(/private/**)'] }, sandbox: { enabled: true }, hooks: { PreToolUse: [priorHook], SubagentStart: [priorHook] } });
  const merged = JSON.parse(await prepareClaudeSubagentStartSettings({ directory, context, settings }, { platform }));
  expect({ ...merged, hooks: { ...merged.hooks, SubagentStart: merged.hooks.SubagentStart.slice(0, 1) } }).toEqual(JSON.parse(settings));
  expect(merged.hooks.SubagentStart).toHaveLength(2);
  const hook = merged.hooks.SubagentStart[1].hooks[0];
  const path = join(directory, 'subagent-start.json');
  const quoted = platform === 'win32' ? path.replaceAll("'", "''") : path.replaceAll("'", "'\\''");
  expect(hook).toEqual(platform === 'win32'
    ? { type: 'command', command: `Get-Content -Raw -Encoding UTF8 -LiteralPath '${quoted}'`, shell: 'powershell', timeout: 5 }
    : { type: 'command', command: `cat -- '${quoted}'`, timeout: 5 });
  const output = await readFile(path, 'utf8');
  const additionalContext = `Parent plugins: ${JSON.stringify(context.ids)}.\n${context.instructions}`;
  expect(JSON.parse(output)).toEqual({ hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext } });
  expect(additionalContext.length).toBeLessThan(2000);
  expect(output).not.toContain('FULL_SKILL_TEXT');
  if ((platform === 'win32') === (process.platform === 'win32')) {
    expect(execSync(hook.command, { encoding: 'utf8', ...(platform === 'win32' ? { shell: 'powershell' } : {}) }).trim()).toBe(output);
  }
  if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600);
});

it('uses an IDs-only manifest for a long list without dropping any approved ID', async () => {
  const directory = join(scratch, 'manifest');
  await mkdir(directory);
  const ids = Array.from({ length: 120 }, (_, i) => `plugin-${i}-${'x'.repeat(32)}`);
  await prepareClaudeSubagentStartSettings({ directory, context: { ...context, ids } }, {});
  const manifest = join(directory, 'subagent-plugin-ids.json');
  expect(JSON.parse(await readFile(manifest, 'utf8'))).toEqual(ids);
  const output = JSON.parse(await readFile(join(directory, 'subagent-start.json'), 'utf8')).hookSpecificOutput.additionalContext;
  expect(output).toContain(JSON.stringify(manifest));
  expect(output).toContain('read');
  expect(output).toContain('every ID');
  expect(output).toContain(context.instructions);
  expect(output.length).toBeLessThan(2000);
  expect(await readdir(directory)).toEqual(['subagent-plugin-ids.json', 'subagent-start.json']);
});

it('keeps context below 2000 JS characters and refuses instructions that cannot fit', async () => {
  const directory = join(scratch, 'budget');
  await mkdir(directory);
  const instructions = 'x'.repeat(1999 - 'Parent plugins: [].\n'.length);
  await prepareClaudeSubagentStartSettings({ directory, context: { ids: [], instructions } }, {});
  expect(JSON.parse(await readFile(join(directory, 'subagent-start.json'), 'utf8')).hookSpecificOutput.additionalContext.length).toBe(1999);
  await expect(prepareClaudeSubagentStartSettings({ directory, context: { ids: [], instructions: `${instructions}x` } }, {})).rejects.toThrow('2000');
});

it('refuses to overwrite a staged pointer and rejects invalid settings', async () => {
  const directory = join(scratch, 'exclusive');
  await mkdir(directory);
  await prepareClaudeSubagentStartSettings({ directory, context }, {});
  await expect(prepareClaudeSubagentStartSettings({ directory, context }, {})).rejects.toMatchObject({ code: 'EEXIST' });
  await expect(prepareClaudeSubagentStartSettings({ directory, context, settings: '{' }, {})).rejects.toThrow();
});
