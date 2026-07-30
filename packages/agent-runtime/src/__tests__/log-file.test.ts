import { existsSync, statSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { prepareAgentLogFile } from '../log-file.js';
import type { RuntimeAgentDef } from '../types.js';

function defWith(overrides: Partial<RuntimeAgentDef> = {}): RuntimeAgentDef {
  return {
    id: 'fake-log-agent',
    name: 'Fake Log Agent',
    bin: 'fake-log-agent',
    versionArgs: ['--version'],
    fallbackModels: [],
    buildArgs: () => [],
    streamFormat: 'plain',
    ...overrides,
  };
}

describe('prepareAgentLogFile', () => {
  it('returns null for a def that did not opt in, without touching the filesystem', async () => {
    const mkdtemp = vi.spyOn(fs, 'mkdtemp');
    try {
      expect(await prepareAgentLogFile(defWith(), 'run-1')).toBeNull();
      expect(mkdtemp).not.toHaveBeenCalled();
    } finally {
      mkdtemp.mockRestore();
    }
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
  ])('returns null for a %s def, so a caller can invoke it unconditionally', async (_label, def) => {
    expect(await prepareAgentLogFile(def, 'run-1')).toBeNull();
  });

  it('stages a path inside a fresh 0o700 temp directory, and does NOT pre-create the file itself', async () => {
    const staged = await prepareAgentLogFile(defWith({ needsAgentLogFile: true }), 'run-42');
    expect(staged).not.toBeNull();
    try {
      const dir = path.dirname(staged!.path);
      expect(path.basename(staged!.path)).toBe('agent.log');
      expect(dir.startsWith(os.tmpdir())).toBe(true);
      expect(path.basename(dir)).toContain('agent-runtime-fake-log-agent-run-42-log-');
      // The directory exists and is owner-only — the actual confidentiality
      // control, since the spawned CLI (not this module) picks the log file's
      // own mode. `mkdtemp` guarantees 0o700.
      expect(statSync(dir).isDirectory()).toBe(true);
      expect(statSync(dir).mode & 0o777).toBe(0o700);
      // Deliberately absent: this is output the CLI authors, not input we
      // author. See the module doc.
      expect(existsSync(staged!.path)).toBe(false);
    } finally {
      await staged!.cleanup();
    }
  });

  it('cleanup removes the directory along with whatever the CLI wrote into it', async () => {
    const staged = await prepareAgentLogFile(defWith({ needsAgentLogFile: true }), 'run-cleanup');
    const dir = path.dirname(staged!.path);
    await fs.writeFile(staged!.path, 'E log.go:398] some diagnostic the CLI emitted\n', 'utf8');
    expect(existsSync(staged!.path)).toBe(true);

    await staged!.cleanup();

    expect(existsSync(staged!.path)).toBe(false);
    expect(existsSync(dir)).toBe(false);
  });

  it('cleanup is safe to call twice (the executor releases on more than one path)', async () => {
    const staged = await prepareAgentLogFile(defWith({ needsAgentLogFile: true }), 'run-twice');
    await staged!.cleanup();
    await expect(staged!.cleanup()).resolves.toBeUndefined();
  });

  it('sanitizes path separators out of the label so a run id cannot escape os.tmpdir()', async () => {
    const staged = await prepareAgentLogFile(defWith({ needsAgentLogFile: true }), '../../etc/passwd');
    try {
      const dir = path.dirname(staged!.path);
      // The decisive assertion: the staged directory is a *direct* child of
      // os.tmpdir(), so the `../..` in the label traversed nothing.
      expect(path.dirname(dir)).toBe(os.tmpdir());
      expect(path.basename(dir)).toMatch(/^agent-runtime-fake-log-agent-\.\.-\.\.-etc-passwd-log-/);
    } finally {
      await staged!.cleanup();
    }
  });

  it('truncates an overlong label to 80 characters rather than blowing the path limit', async () => {
    const staged = await prepareAgentLogFile(defWith({ needsAgentLogFile: true }), 'x'.repeat(200));
    try {
      // Anchored at both ends around `mkdtemp`'s own six random characters, so
      // an 81st `x` would fail this rather than slipping past a prefix match.
      expect(path.basename(path.dirname(staged!.path))).toMatch(
        /^agent-runtime-fake-log-agent-x{80}-log-[A-Za-z0-9]{6}$/,
      );
    } finally {
      await staged!.cleanup();
    }
  });

  it("falls back to the 'agent' label when the caller passes an empty one", async () => {
    const staged = await prepareAgentLogFile(defWith({ needsAgentLogFile: true }), '');
    try {
      expect(path.basename(path.dirname(staged!.path))).toMatch(/^agent-runtime-fake-log-agent-agent-log-/);
    } finally {
      await staged!.cleanup();
    }
  });
});
