import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveAgentBin } from '../resolution.js';

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
