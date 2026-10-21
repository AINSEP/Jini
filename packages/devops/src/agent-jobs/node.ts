import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { stat, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import type { AgentCliRunnerPort, JobFilesystemPort, AgentJob } from './ports.js';

/** Environment is required: the host explicitly chooses which credentials/config reach the CLI. */
export function createNodeAgentCliRunner({ env }: { env: NodeJS.ProcessEnv }): AgentCliRunnerPort {
  const environment = { ...env };
  return { async run(request) {
    const child = spawn(request.executable, [...request.args], { cwd: request.cwd, env: environment, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    const exited = new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    const input = new Promise<void>((resolve, reject) => {
      child.stdin.once('error', reject);
      child.stdin.end(request.stdin, () => resolve());
    });
    const pending = [exited, input, pipeline(child.stdout, createWriteStream(request.jsonlPath)), pipeline(child.stderr, createWriteStream(request.stderrPath))] as const;
    try {
      const [exitCode] = await Promise.all(pending);
      return { exitCode };
    } catch (error) {
      child.kill();
      await Promise.allSettled(pending);
      throw error;
    }
  } };
}
/** Writes final/failed artifacts; raw logs are streamed by the CLI adapter. */
export function createNodeJobFilesystem(_required: Record<string, never>): JobFilesystemPort {
  return {
    mkdir: async ({ path }) => { await mkdir(path, { recursive: true }); },
    exists: async ({ path }) => {
      try { return (await stat(path)).isFile(); }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT' || code === 'ENOTDIR') return false;
        throw error;
      }
    },
    read: ({ path }) => readFile(path, 'utf8'),
    write: ({ path, text }) => writeFile(path, text, 'utf8'),
    remove: async ({ path }) => { await rm(path, { force: true }); },
  };
}
/** The prompt directory as `readPromptJobs` sees it; the default reads the real filesystem. */
export interface PromptDirectoryPort {
  list(required: { directory: string }): Promise<readonly { readonly name: string; isFile(): boolean }[]>;
  read(required: { path: string }): Promise<string>;
}
const nodePromptDirectory: PromptDirectoryPort = {
  list: ({ directory }) => readdir(directory, { withFileTypes: true }),
  read: ({ path: file }) => readFile(file, 'utf8'),
};
/** Read regular prompt files in stable order; duplicate basename IDs are rejected by runAgentJobs. */
export async function readPromptJobs({ directory }: { directory: string }, { files = nodePromptDirectory }: { files?: PromptDirectoryPort } = {}): Promise<AgentJob[]> {
  // Names within one directory are unique, so no two entries compare equal: the former `: 0` arm was unreachable.
  const entries = (await files.list({ directory })).filter(entry => entry.isFile()).sort((a, b) => a.name < b.name ? -1 : 1);
  return Promise.all(entries.map(async entry => ({ id: path.parse(entry.name).name, prompt: await files.read({ path: path.join(directory, entry.name) }) })));
}
