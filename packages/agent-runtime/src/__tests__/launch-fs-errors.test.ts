import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A couple of defensive catch branches in launch.ts (safeRealpath()'s
// realpathSync failure, and looksLikeCodexNodeWrapper()'s "best-effort
// close" around closeSync) are not reachable through any real filesystem
// state reachable from the public API — by the time those functions run,
// the file has already been validated as a real, readable/executable file
// moments earlier in the same synchronous call. Isolated in its own file so
// only these two fs functions are faked; everything else (statSync,
// accessSync, openSync, readSync, readdirSync, ...) stays real so the rest
// of the resolution logic runs against genuine fixture files on disk.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    realpathSync: () => {
      throw new Error('simulated realpath failure');
    },
    closeSync: () => {
      throw new Error('simulated close failure');
    },
  };
});

import { resolveAgentLaunch } from '../launch.js';
import type { RuntimeAgentDef } from '../types.js';

function makeDef(overrides: Partial<RuntimeAgentDef> = {}): RuntimeAgentDef {
  return {
    id: 'test-agent',
    name: 'Test Agent',
    bin: 'test-agent',
    versionArgs: [],
    buildArgs: () => [],
    fallbackModels: [],
    streamFormat: 'plain',
    ...overrides,
  } as RuntimeAgentDef;
}

describe('resolveAgentLaunch when realpathSync/closeSync fail', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'agent-runtime-launch-fs-errors-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('still classifies the wrapper correctly when safeRealpath() swallows a realpathSync throw', () => {
    const binPath = path.join(dir, 'codex');
    writeFileSync(binPath, '#!/usr/bin/env node\nrequire("@openai/codex-cli");\n', 'utf8');
    chmodSync(binPath, 0o755);

    const def = makeDef({ id: 'codex', bin: 'codex' });
    const result = resolveAgentLaunch({ def: def }, { configuredEnv: { CODEX_BIN: binPath } });

    // No native binary present, wrapper looks like a node wrapper (content
    // read via the still-real openSync/readSync succeeds even though
    // closeSync throws in its finally block) -> diagnostic surfaced,
    // proving both the realpathSync-catch and closeSync-catch paths ran
    // without throwing out of resolveAgentLaunch.
    expect(result.launchKind).toBe('selected');
    expect(result.launchPath).toBe(binPath);
    expect(result.diagnostic).toContain('Codex native binary was not found');
  });
});
