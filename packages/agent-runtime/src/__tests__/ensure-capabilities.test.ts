import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockState = vi.hoisted(() => ({
  calls: [] as { file: string; args: string[] }[],
  responses: new Map<string, { stdout?: string; error?: Error }>(),
}));

vi.mock('node:child_process', () => ({
  execFile: (
    file: string,
    args: string[],
    _options: unknown,
    cb: (err: Error | null, result?: { stdout: string; stderr: string }) => void,
  ) => {
    mockState.calls.push({ file, args });
    const response = mockState.responses.get(file);
    if (!response || response.error) {
      cb(response?.error ?? Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      return;
    }
    cb(null, { stdout: response.stdout ?? '', stderr: '' });
  },
}));

import { ensureAgentCapabilities } from '../detection.js';
import { agentCapabilities } from '../capabilities.js';
import { getAgentDef } from '../registry.js';

const CLAUDE_HELP = 'Usage: claude [options]\n  --include-partial-messages\n  --add-dir <dirs...>\n  --effort <level>\n  --append-system-prompt <prompt>\n';

describe('ensureAgentCapabilities — fills the capability gate on the run path, not only in detectAgents', () => {
  beforeEach(() => {
    agentCapabilities.clear();
    mockState.calls.length = 0;
    mockState.responses.clear();
  });

  it('probes `claude -p --help` once, and buildArgs then streams partial messages and passes --effort', async () => {
    const def = getAgentDef('claude')!;
    mockState.responses.set('/fake/bin/claude-a', { stdout: CLAUDE_HELP });

    const before = def.buildArgs('', [], [], { reasoning: 'high' }, {});
    expect(before).not.toContain('--include-partial-messages');

    await Promise.all([
      ensureAgentCapabilities(def, '/fake/bin/claude-a', {}),
      ensureAgentCapabilities(def, '/fake/bin/claude-a', {}),
    ]);
    await ensureAgentCapabilities(def, '/fake/bin/claude-a', {});

    expect(mockState.calls).toEqual([{ file: '/fake/bin/claude-a', args: ['-p', '--help'] }]);
    expect(agentCapabilities.get('claude')).toEqual({
      partialMessages: true,
      addDir: true,
      effort: true,
      appendSystemPrompt: true,
    });
    const after = def.buildArgs('', [], [], { reasoning: 'high' }, {});
    expect(after).toContain('--include-partial-messages');
    expect(after.slice(after.indexOf('--effort'), after.indexOf('--effort') + 2)).toEqual(['--effort', 'high']);
  });

  it('keeps an existing detectAgents result and spawns nothing', async () => {
    const def = getAgentDef('claude')!;
    agentCapabilities.set('claude', { partialMessages: false });
    await ensureAgentCapabilities(def, '/fake/bin/claude-b', {});
    expect(mockState.calls).toEqual([]);
    expect(agentCapabilities.get('claude')).toEqual({ partialMessages: false });
  });

  it('records nothing when the probe fails, and does not re-spawn it on the next run', async () => {
    const def = getAgentDef('claude')!;
    mockState.responses.set('/fake/bin/claude-c', { error: new Error('boom') });
    await ensureAgentCapabilities(def, '/fake/bin/claude-c', {});
    await ensureAgentCapabilities(def, '/fake/bin/claude-c', {});
    expect(mockState.calls).toHaveLength(1);
    expect(agentCapabilities.has('claude')).toBe(false);
    expect(def.buildArgs('', [], [], {}, {})).not.toContain('--include-partial-messages');
  });

  it('is a no-op for a def with no help probe', async () => {
    const { helpArgs: _h, capabilityFlags: _c, ...rest } = getAgentDef('claude')!;
    const def = { ...rest, id: 'no-probe' };
    await ensureAgentCapabilities(def, '/fake/bin/x', {});
    expect(mockState.calls).toEqual([]);
  });
});
