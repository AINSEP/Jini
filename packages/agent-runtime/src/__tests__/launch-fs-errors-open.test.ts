import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// looksLikeCodexNodeWrapper()'s own `catch { return false; }` (the outer
// try/catch around openSync/readSync, distinct from the "best-effort close"
// catch already exercised in launch-fs-errors.test.ts) has no real,
// deterministic, non-root filesystem trigger: by the time it runs, the
// wrapper path has already been confirmed to be a readable regular file
// moments earlier via `executableFilePath`'s `statSync(...).isFile()` +
// `accessSync(..., X_OK)` (see executables.ts). The one real technique that
// used to exercise it (chmod 0o111 to strip the read bit) only fails for a
// non-root user — root has CAP_DAC_OVERRIDE and opens it anyway, verified
// empirically on this exact host (`fs.openSync` on a 0o111 file as uid 0
// succeeds) — see this file's sibling `launch.test.ts`'s
// `codex-wrapper-unreadable` test, skipped under uid 0 for the same reason.
// Isolated in its own file (only `openSync` faked) following
// `launch-fs-errors.test.ts`'s own established precedent of surgically
// mocking a single `node:fs` export while keeping the rest of the module
// real, so the rest of the resolution logic still runs against genuine
// fixture files on disk.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    openSync: () => {
      throw new Error('simulated open failure');
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

describe('resolveAgentLaunch when openSync fails inside looksLikeCodexNodeWrapper', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'agent-runtime-launch-fs-errors-open-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('treats an unreadable wrapper as "not a node wrapper" (no diagnostic) when openSync throws', () => {
    const binPath = path.join(dir, 'codex');
    // Content would otherwise clearly match the node-wrapper sniff regex —
    // the point is that openSync throwing short-circuits before the regex
    // test ever runs, not that the content itself is ambiguous.
    writeFileSync(binPath, '#!/usr/bin/env node\nrequire("@openai/codex-cli");\n', 'utf8');
    chmodSync(binPath, 0o755);

    const def = makeDef({ id: 'codex', bin: 'codex' });
    const result = resolveAgentLaunch({ def: def }, { configuredEnv: { CODEX_BIN: binPath } });

    expect(result.launchKind).toBe('selected');
    expect(result.launchPath).toBe(binPath);
    expect(result.diagnostic).toBeNull();
  });
});
