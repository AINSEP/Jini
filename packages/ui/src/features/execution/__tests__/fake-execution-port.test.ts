import { describe, expect, it } from 'vitest';
import { createFakeExecutionPort } from '../dependencies.js';
import type { ByokConfig, DetectedAgent } from '../types.js';

/**
 * @file Contract for the shipped in-memory `ExecutionPort` double: hosts and demos rely on it
 * reproducing every observable outcome of the real port (resolve, value-level failure, rejection)
 * with or without simulated latency.
 */

const complete: ByokConfig = { protocol: 'openai', providerId: null, apiKey: 'typed', baseUrl: 'https://example.test', model: 'model-a' };
const agents: readonly DetectedAgent[] = [
  { id: 'ready', label: 'Ready CLI', installed: true },
  { id: 'absent', label: 'Absent CLI', installed: false },
];

describe('createFakeExecutionPort', () => {
  it('returns fresh copies of the configured agents on both detect and rescan', async () => {
    const port = createFakeExecutionPort({ agents });
    const detected = await port.detectLocalAgents();
    const rescanned = await port.rescanLocalAgents!();
    expect(detected).toEqual(agents);
    expect(rescanned).toEqual(agents);
    expect(detected[0]).not.toBe(agents[0]);
    expect(rescanned[0]).not.toBe(detected[0]);
  });

  it('rejects both detect and rescan with the configured detection error', async () => {
    const port = createFakeExecutionPort({ agentsError: 'daemon offline' });
    await expect(port.detectLocalAgents()).rejects.toThrow('daemon offline');
    await expect(port.rescanLocalAgents!()).rejects.toThrow('daemon offline');
  });

  it('defaults the connection verdict to whether every required credential is non-blank', async () => {
    const port = createFakeExecutionPort();
    await expect(port.testConnection(complete)).resolves.toEqual({ ok: true, message: 'Connection succeeded' });
    await expect(port.testConnection({ ...complete, apiKey: '  ' })).resolves.toEqual({ ok: false, message: 'Missing credentials' });
    await expect(port.testConnection({ ...complete, baseUrl: '' })).resolves.toEqual({ ok: false, message: 'Missing credentials' });
    await expect(port.testConnection({ ...complete, model: ' ' })).resolves.toEqual({ ok: false, message: 'Missing credentials' });
  });

  it('honours a forced connection verdict', async () => {
    const port = createFakeExecutionPort({ testResult: { ok: false, message: 'forced' } });
    await expect(port.testConnection(complete)).resolves.toEqual({ ok: false, message: 'forced' });
  });

  it('defaults the agent verdict to whether that agent is detected and installed', async () => {
    const port = createFakeExecutionPort({ agents });
    await expect(port.testAgent!('ready')).resolves.toEqual({ ok: true, message: 'Ready CLI is ready' });
    await expect(port.testAgent!('absent')).resolves.toEqual({ ok: false, message: 'absent is not installed' });
    await expect(port.testAgent!('unknown')).resolves.toEqual({ ok: false, message: 'unknown is not installed' });
  });

  it('honours a forced agent verdict and a forced agent rejection, rejection first', async () => {
    const forced = { ok: true, message: 'forced', usedExecutableSource: 'fallback-failed' as const, detectedExecutablePath: '/bin/agent' };
    await expect(createFakeExecutionPort({ agentTestResult: forced }).testAgent!('absent')).resolves.toEqual(forced);
    await expect(createFakeExecutionPort({ agentTestResult: forced, agentTestError: 'cannot run' }).testAgent!('ready')).rejects.toThrow('cannot run');
  });

  it('lists the configured models, the default catalog, or rejects with the discovery error', async () => {
    await expect(createFakeExecutionPort({ models: ['only'] }).listModels!(complete)).resolves.toEqual(['only']);
    await expect(createFakeExecutionPort().listModels!(complete)).resolves.toEqual(['example-model-large', 'example-model-small']);
    await expect(createFakeExecutionPort({ modelsError: 'bad key' }).listModels!(complete)).rejects.toThrow('bad key');
  });

  it('delays both resolutions and rejections by the simulated latency', async () => {
    const port = createFakeExecutionPort({ models: ['slow'], latencyMs: 5 });
    let settled = false;
    const listing = port.listModels!(complete).then((models) => { settled = true; return models; });
    await Promise.resolve();
    expect(settled).toBe(false);
    await expect(listing).resolves.toEqual(['slow']);

    const failing = createFakeExecutionPort({ agentsError: 'slow failure', latencyMs: 5 });
    let rejected = false;
    const detection = failing.detectLocalAgents().catch((error: unknown) => { rejected = true; throw error; });
    await Promise.resolve();
    expect(rejected).toBe(false);
    await expect(detection).rejects.toThrow('slow failure');
  });
});
