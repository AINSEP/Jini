import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { buildClaudeMcpDelivery, writeMcpJsonForRun } from '../claude/mcp-delivery.js';

const entry = (runId: string) => ({ command: 'host-bridge', args: ['serve'], env: { JINI_RUN_ID: runId } });

it('writes independent run credentials without modifying the project MCP file', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'claude-mcp-delivery-'));
  const project = '{"notes":"keep","mcpServers":{"calendar":{"command":"custom"},"bridge":{"command":"stale"}}}';
  const first = buildClaudeMcpDelivery({ cwd, runId: '../red/job', serverEntry: entry('red') });
  const second = buildClaudeMcpDelivery({ cwd, runId: 'blue', serverEntry: entry('blue') });
  try {
    const source = join(cwd, '.mcp.json');
    await writeFile(source, project);
    await expect(Promise.all([first, second].map(delivery => writeMcpJsonForRun({
      cwd, delivery, options: {}, serverName: 'bridge',
    })))).resolves.toEqual([join(cwd, '.mcp.jini-___red_job.json'), join(cwd, '.mcp.jini-blue.json')]);
    expect(JSON.parse(await readFile(first.mcpJsonPath, 'utf8'))).toEqual({
      notes: 'keep', mcpServers: { calendar: { command: 'custom' }, bridge: entry('red') },
    });
    expect(JSON.parse(await readFile(second.mcpJsonPath, 'utf8'))).toEqual({
      notes: 'keep', mcpServers: { calendar: { command: 'custom' }, bridge: entry('blue') },
    });
    expect(await readFile(source, 'utf8')).toBe(project);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

it.each([true, false])('stages a bridge-only config when project reading is unavailable or disabled (inherit: %s)', async inheritUserConfig => {
  const cwd = await mkdtemp(join(tmpdir(), 'claude-mcp-delivery-'));
  const readFilePort = vi.fn(async () => { throw new Error('no project config'); });
  const delivery = buildClaudeMcpDelivery({ cwd, runId: 'x'.repeat(129), serverEntry: entry('fixture') });
  try {
    await expect(writeMcpJsonForRun({ cwd, delivery, options: { readFile: readFilePort }, serverName: 'bridge' },
      { inheritUserConfig })).resolves.toBe(join(cwd, `.mcp.jini-${'x'.repeat(128)}.json`));
    expect(readFilePort.mock.calls).toEqual(inheritUserConfig ? [[{ path: join(cwd, '.mcp.json') }]] : []);
    expect(JSON.parse(await readFile(delivery.mcpJsonPath, 'utf8'))).toEqual({ mcpServers: { bridge: entry('fixture') } });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

it.each([
  { kind: 'other', mcpJsonPath: '/scratch/mcp.json', serverEntry: entry('red') },
  { kind: 'claude-mcp-json', serverEntry: entry('red') },
  { kind: 'claude-mcp-json', mcpJsonPath: '/scratch/mcp.json' },
])('refuses an incomplete or foreign delivery before file I/O (%j)', async delivery => {
  const readFile = vi.fn(async () => '{}');
  const writeFile = vi.fn(async () => {});
  await expect(writeMcpJsonForRun({ cwd: '/workspace', delivery, options: { readFile, writeFile }, serverName: 'bridge' }))
    .rejects.toThrow(new TypeError('Unexpected MCP delivery'));
  expect(readFile.mock.calls).toEqual([]);
  expect(writeFile.mock.calls).toEqual([]);
});
