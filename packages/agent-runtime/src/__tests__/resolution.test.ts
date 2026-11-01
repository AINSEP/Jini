import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAgentSelectionResolver, resolveAgentBin } from '../resolution.js';

describe('saved agent selection', () => {
  it('falls back for removed and unknown ids, warning only once per resolver', () => {
    const onFallback = vi.fn();
    const resolve = createAgentSelectionResolver({ defaultAgentId: 'claude', onFallback });
    expect(resolve({ agentId: 'copilot' })).toBe('claude');
    expect(resolve({ agentId: 'copilot' })).toBe('claude');
    expect(resolve({ agentId: 'no-longer-registered' })).toBe('claude');
    expect(onFallback.mock.calls).toEqual([[{ agentId: 'copilot', defaultAgentId: 'claude' }]]);
  });

  it('preserves known selections and silently defaults an omitted selection', () => {
    const onFallback = vi.fn();
    const resolve = createAgentSelectionResolver({ defaultAgentId: 'claude', onFallback });
    expect(resolve({ agentId: 'codex' })).toBe('codex');
    expect(resolve({})).toBe('claude');
    expect(onFallback).not.toHaveBeenCalled();
  });

  it('uses the host registry and default, keeping warning state local to the resolver', () => {
    const getDef = ({ id }: { id: string }) => id === 'custom' ? { id } : null;
    const onFallback = vi.fn();
    const resolve = createAgentSelectionResolver({ defaultAgentId: 'custom', onFallback }, { getDef });
    expect(resolve({ agentId: 'custom' })).toBe('custom');
    expect(resolve({ agentId: 'claude' })).toBe('custom');
    const another = createAgentSelectionResolver({ defaultAgentId: 'custom', onFallback }, { getDef });
    expect(another({ agentId: 'copilot' })).toBe('custom');
    expect(onFallback).toHaveBeenCalledTimes(2);
  });
});

describe('resolveAgentBin', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'agent-runtime-resolution-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns null for an unknown agent id', () => {
    expect(resolveAgentBin({ id: 'not-a-real-agent-id' })).toBeNull();
  });

  it('returns null for a known agent id with nothing configured or on PATH', () => {
    // This dev machine may have a real `claude` CLI installed for real via
    // Homebrew/npm-global — scope PATH + the toolchain-bin-dir search to an
    // isolated empty fake home so this assertion doesn't accidentally
    // depend on the host machine's own installed tools.
    const originalPath = process.env.PATH;
    process.env.AGENT_RUNTIME_HOME = dir;
    process.env.PATH = dir;
    try {
      expect(resolveAgentBin({ id: 'claude' }, { configuredEnv: {} })).toBeNull();
    } finally {
      process.env.PATH = originalPath;
      delete process.env.AGENT_RUNTIME_HOME;
    }
  });

  it('resolves a known agent id to its configured-override binary path', () => {
    const bin = path.join(dir, 'claude');
    writeFileSync(bin, 'stub', 'utf8');
    chmodSync(bin, 0o755);
    expect(resolveAgentBin({ id: 'claude' }, { configuredEnv: { CLAUDE_BIN: bin } })).toBe(bin);
  });

  it('defaults configuredEnv to an empty object when omitted', () => {
    const originalPath = process.env.PATH;
    process.env.AGENT_RUNTIME_HOME = dir;
    process.env.PATH = dir;
    try {
      expect(resolveAgentBin({ id: 'claude' })).toBeNull();
    } finally {
      process.env.PATH = originalPath;
      delete process.env.AGENT_RUNTIME_HOME;
    }
  });
});
