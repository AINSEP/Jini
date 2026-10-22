/** Real packed imports cannot resolve the optional peer through workspace symlinks. */
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { copyRuntimeTree, fixture, pack, packages, run } from '../../../scripts/testing/packed-fixture.js';
import { defaultModelDiscoveryDeps } from '../src/model-discovery-adapters.js';

const RUNTIME = '@jini-ai/agent-runtime';
const CATALOG = '@jini-ai/integrations/media-providers/catalog';
const LOAD_ERROR = 'Could not load @jini-ai/integrations/media-providers/catalog. Install the optional peer @jini-ai/integrations or inject ModelDiscoveryDeps.credential to discover models with default provider URLs.';
let dir: string;

beforeAll(() => {
  dir = fixture('jini-agent-runtime-no-integrations-');
  // Consume the coordinator's fresh build; no package build runs inside this test.
  pack(dir, 'agent-runtime');
  for (const name of ['core', 'protocol', 'platform', 'oauth']) {
    copyRuntimeTree(dir, `@jini-ai/${name}`, join(packages, name));
  }
}, 60_000);

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('@jini-ai/agent-runtime without its optional integrations peer', () => {
  it('POSITIVE CONTROL: the catalog cannot resolve in the copied install', () => {
    expect(existsSync(join(dir, 'node_modules/@jini-ai/integrations'))).toBe(false);
    const result = run(dir, `await import(${JSON.stringify(CATALOG)});`);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('ERR_MODULE_NOT_FOUND');
    expect(result.stderr).toContain("Cannot find package '@jini-ai/integrations'");
  });

  it('imports the root and uses the legacy discovery API and owned native runtime', () => {
    const result = run(dir, `
      const m = await import(${JSON.stringify(RUNTIME)});
      const runtime = m.createNativeAgentRuntime({ env: {} });
      const discovery = m.createAgentModelDiscovery('aider', { fallbackModels: () => [] });
      const deps = m.getRuntimeModelDiscoveryDeps({ state: runtime.state });
      process.stdout.write(JSON.stringify([
        runtime.getAgentDef({ id: 'claude' }).id,
        typeof discovery.discoverModels,
        typeof discovery.resolveDefaultModel,
        deps.cache === runtime.state.modelCatalog,
        m.parseClaudeInitializeMetadata('invalid'),
      ]));
      await runtime.dispose({});
    `);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(['claude', 'function', 'function', true, null]);
  });

  it('returns no connection when no usable provider credentials or selection exist', () => {
    const result = run(dir, `
      const { defaultModelDiscoveryDeps: deps } = await import(${JSON.stringify(RUNTIME)});
      const signal = new AbortController().signal;
      const context = { executable: '/fake/cli', cwd: '/workspace', env: {} };
      const absent = await deps.credential.connection({ agentId: 'claude', context, signal });
      const unselected = await deps.credential.connection({ agentId: 'aider', context: { ...context, env: { OPENAI_API_KEY: 'test-key' } }, signal });
      const uncredentialed = await deps.credential.connection({ agentId: 'aider', context: { ...context, model: 'openai/gpt-test' }, signal });
      process.stdout.write(JSON.stringify([absent, unselected, uncredentialed]));
    `);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([null, null, null]);
  });

  it.each([
    { agentId: 'claude', env: { ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: 'https://anthropic.example' }, model: '', protocol: 'anthropic', baseUrl: 'https://anthropic.example' },
    { agentId: 'aider', env: { ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: 'https://anthropic.example' }, model: 'anthropic/claude-test', protocol: 'anthropic', baseUrl: 'https://anthropic.example' },
    { agentId: 'aider', env: { OPENROUTER_API_KEY: 'test-key', OPENROUTER_API_BASE: 'https://router.example' }, model: 'openrouter/test', protocol: 'openai', baseUrl: 'https://router.example' },
    { agentId: 'aider', env: { OPENAI_API_KEY: 'test-key', OPENAI_BASE_URL: 'https://primary.example', OPENAI_API_BASE: 'https://secondary.example' }, model: 'openai/gpt-test', protocol: 'openai', baseUrl: 'https://primary.example' },
    { agentId: 'qwen', env: { OPENAI_API_KEY: 'test-key', OPENAI_API_BASE: 'https://secondary.example', OPENAI_MODEL: 'custom' }, model: 'custom', protocol: 'openai', baseUrl: 'https://secondary.example' },
  ])('uses explicit provider URLs without integrations ($agentId / $model)', ({ agentId, env, model, protocol, baseUrl }) => {
    const result = run(dir, `
      const { defaultModelDiscoveryDeps: deps } = await import(${JSON.stringify(RUNTIME)});
      const connection = await deps.credential.connection({
        agentId: ${JSON.stringify(agentId)},
        context: { executable: '/fake/cli', cwd: '/workspace', env: ${JSON.stringify(env)}, model: ${JSON.stringify(model)} },
        signal: new AbortController().signal,
      });
      process.stdout.write(JSON.stringify(connection));
    `);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ protocol, baseUrl, apiKey: 'test-key' });
  });

  it.each([
    { model: 'anthropic/claude-test', env: { ANTHROPIC_API_KEY: 'test-key' } },
    { model: 'google/gemini-test', env: { GEMINI_API_KEY: 'test-key' } },
    { model: 'openrouter/test', env: { OPENROUTER_API_KEY: 'test-key' } },
    { model: 'openai/gpt-test', env: { OPENAI_API_KEY: 'test-key' } },
  ])('reports the missing peer only when a default URL is needed ($model)', ({ model, env }) => {
    const result = run(dir, `
      const { defaultModelDiscoveryDeps: deps } = await import(${JSON.stringify(RUNTIME)});
      try {
        await deps.credential.connection({
          agentId: 'aider',
          context: { executable: '/fake/cli', cwd: '/workspace', env: ${JSON.stringify(env)}, model: ${JSON.stringify(model)} },
          signal: new AbortController().signal,
        });
        process.stdout.write('unexpected success');
      } catch (error) {
        process.stdout.write(JSON.stringify([error.message, error.cause.code]));
      }
    `);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([LOAD_ERROR, 'ERR_MODULE_NOT_FOUND']);
  });
});

it.each([
  { agentId: 'claude', model: '', env: { ANTHROPIC_API_KEY: 'test-key' }, protocol: 'anthropic', baseUrl: 'https://api.anthropic.com' },
  { agentId: 'aider', model: 'anthropic/claude-test', env: { ANTHROPIC_API_KEY: 'test-key' }, protocol: 'anthropic', baseUrl: 'https://api.anthropic.com' },
  { agentId: 'aider', model: 'google/gemini-test', env: { GEMINI_API_KEY: 'test-key' }, protocol: 'google', baseUrl: 'https://generativelanguage.googleapis.com' },
  { agentId: 'aider', model: 'openrouter/test', env: { OPENROUTER_API_KEY: 'test-key' }, protocol: 'openai', baseUrl: 'https://openrouter.ai/api/v1' },
  { agentId: 'aider', model: 'openai/gpt-test', env: { OPENAI_API_KEY: 'test-key' }, protocol: 'openai', baseUrl: 'https://api.openai.com/v1' },
])('keeps the catalog-owned defaults when integrations is installed ($agentId / $model)', async ({ agentId, model, env, protocol, baseUrl }) => {
  const connection = await defaultModelDiscoveryDeps.credential.connection({
    agentId,
    context: { executable: '/fake/cli', cwd: '/workspace', env, model },
    signal: new AbortController().signal,
  });
  expect(connection).toEqual({ protocol, baseUrl, apiKey: 'test-key' });
});
