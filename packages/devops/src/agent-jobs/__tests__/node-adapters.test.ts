/** The Node adapters' failure paths and the public `./agent-jobs` entry, against real processes and a temp directory. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import * as entry from '../entry.js';
import { createNodeAgentCliRunner, createNodeJobFilesystem, readPromptJobs } from '../node.js';

let root = '';
beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), 'agent-jobs-adapters-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

it('the agent-jobs entry exposes the batch runner, parser and Node adapters together', () => {
  expect(Object.keys(entry).sort()).toEqual(['buildCodexInvocation', 'createNodeAgentCliRunner', 'createNodeJobFilesystem', 'parseCodexRun', 'readPromptJobs', 'runAgentJobs']);
  expect(entry.parseCodexRun({ jsonl: '{"type":"turn.completed"}\n{"type":"item.completed","item":{"type":"agent_message","text":"done"}}' })).toEqual({ success: true, finalMessage: 'done\n', usage: null });
});

it('the CLI runner rejects with the spawn error when the executable cannot start', async () => {
  const runner = createNodeAgentCliRunner({ env: {} });
  const missing = path.join(root, 'no-such-cli');
  await expect(runner.run({ executable: missing, args: [], cwd: root, stdin: 'prompt', jsonlPath: path.join(root, 'out.jsonl'), stderrPath: path.join(root, 'out.err') }))
    .rejects.toMatchObject({ code: 'ENOENT' });
});

it('the CLI runner passes only the host-chosen environment and reports a non-zero exit', async () => {
  const script = path.join(root, 'env.mjs');
  await writeFile(script, 'process.stdout.write(JSON.stringify(process.env)); process.exit(3);');
  const runner = createNodeAgentCliRunner({ env: { ONLY_THIS: 'yes' } });
  const jsonlPath = path.join(root, 'out.jsonl');
  expect(await runner.run({ executable: process.execPath, args: [script], cwd: root, stdin: '', jsonlPath, stderrPath: path.join(root, 'out.err') })).toEqual({ exitCode: 3 });
  expect(JSON.parse(await readFile(jsonlPath, 'utf8'))).toMatchObject({ ONLY_THIS: 'yes' });
  expect(JSON.parse(await readFile(jsonlPath, 'utf8'))).not.toHaveProperty('PATH');
});

it('the job filesystem treats only a regular file as existing and rethrows other stat failures', async () => {
  const fs = createNodeJobFilesystem({});
  await fs.mkdir({ path: path.join(root, 'out', 'nested') });
  await fs.write({ path: path.join(root, 'out', 'report.md'), text: 'body' });
  expect(await fs.exists({ path: path.join(root, 'out', 'report.md') })).toBe(true);
  expect(await fs.exists({ path: path.join(root, 'out', 'nested') })).toBe(false);
  expect(await fs.exists({ path: path.join(root, 'out', 'missing.md') })).toBe(false);
  expect(await fs.exists({ path: path.join(root, 'out', 'report.md', 'below-a-file.md') })).toBe(false);
  await expect(fs.exists({ path: path.join(root, 'n'.repeat(300)) })).rejects.toMatchObject({ code: 'ENAMETOOLONG' });
  expect(await fs.read({ path: path.join(root, 'out', 'report.md') })).toBe('body');
  await fs.remove({ path: path.join(root, 'out', 'report.md') });
  await fs.remove({ path: path.join(root, 'out', 'report.md') });
  expect(await fs.exists({ path: path.join(root, 'out', 'report.md') })).toBe(false);
});

it('prompt discovery orders files by code unit and skips directories', async () => {
  // Created out of order on a real directory; the result is code-unit ordered with directories skipped.
  for (const name of ['e', 'b', 'G', 'a', 'h', 'C', 'f', 'd']) await writeFile(path.join(root, `${name}.md`), name);
  await mkdir(path.join(root, 'aa-directory.md'));
  expect((await readPromptJobs({ directory: root })).map(job => job.id)).toEqual(['C', 'G', 'a', 'b', 'd', 'e', 'f', 'h']);
});

it('prompt discovery sorts whatever order the directory listing arrives in', async () => {
  // Some filesystems list in creation order; the injected port makes that order explicit.
  const listed = ['e.md', 'b.md', 'G.md', 'a.md', 'h.md', 'C.md'].map(name => ({ name, isFile: () => true }));
  const reads: string[] = [];
  const jobs = await readPromptJobs({ directory: '/prompts' }, { files: { list: async () => listed, read: async ({ path: file }) => { reads.push(file); return `prompt ${file}`; } } });
  expect(jobs.map(job => job.id)).toEqual(['C', 'G', 'a', 'b', 'e', 'h']);
  expect(jobs[0]).toEqual({ id: 'C', prompt: 'prompt /prompts/C.md' });
  expect(reads.sort()).toEqual(['/prompts/C.md', '/prompts/G.md', '/prompts/a.md', '/prompts/b.md', '/prompts/e.md', '/prompts/h.md']);
});
