import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CLI_EXIT_CODES } from '../errors.js';
import { CommandRegistry } from '../command-registry.js';
import {
  registerRunCommands,
  runCancelCommand,
  runGetCommand,
  runListCommand,
  runStartCommand,
  runWatchCommand,
  watchRunEvents,
  type RunCommandDeps,
} from '../run-command.js';

class ExitSentinel extends Error {
  constructor(public code: number) {
    super(`exit ${code}`);
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}

function sseResponse(status: number, frames: readonly string[]): Response {
  const bytes = new TextEncoder().encode(frames.join(''));
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  return { ok: status >= 200 && status < 300, status, body: stream, text: async () => '' } as unknown as Response;
}

function sseFrame(cursor: string, kind: string, extra: Record<string, unknown> = {}): string {
  return `id: ${cursor}\nevent: ${kind}\ndata: ${JSON.stringify({ kind, opaqueCursor: cursor, ...extra })}\n\n`;
}

function makeDeps(overrides: Partial<RunCommandDeps> = {}): RunCommandDeps & { written: string[]; errWritten: string[] } {
  const written: string[] = [];
  const errWritten: string[] = [];
  return {
    resolveBaseUrl: () => 'http://d.example',
    write: ({ text }: { text: string }) => { written.push(text); },
    writeErr: ({ text }: { text: string }) => { errWritten.push(text); },
    written,
    errWritten,
    ...overrides,
  };
}

function exitingDeps(overrides: Partial<RunCommandDeps> = {}) {
  const deps = makeDeps(overrides);
  const exit = vi.fn(({ code }: { code: number }): never => { throw new ExitSentinel(code); });
  return { ...deps, exit };
}

describe('runStartCommand', () => {
  it('prints usage and returns for --help without making a request', async () => {
    const deps = makeDeps();
    const fetchImpl = vi.fn();
    await runStartCommand({ args: ['--help'], resolveBaseUrl: ({ ...deps, fetchImpl }).resolveBaseUrl }, { ...{ ...deps, fetchImpl } });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(deps.written.join('')).toContain('Usage:');
  });

  it('exits with missing-input when --context-ref is absent', async () => {
    const deps = exitingDeps();
    await expect(runStartCommand({ args: [], resolveBaseUrl: (deps).resolveBaseUrl }, { ...deps })).rejects.toThrow(ExitSentinel);
    expect(deps.exit).toHaveBeenCalledWith({ code: DEFAULT_CLI_EXIT_CODES['missing-input'] });
  });

  it('posts contextRef/agentId/idempotencyKey and prints the JSON result', async () => {
    const deps = makeDeps();
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({ contextRef: 'ctx-1', agentId: 'agent-1', idempotencyKey: 'key-1' });
      return jsonResponse(201, { run: { id: 'run-1', state: 'running' }, started: true });
    });
    await runStartCommand({ args: ['--context-ref', 'ctx-1', '--agent-id', 'agent-1', '--idempotency-key', 'key-1'], resolveBaseUrl: ({ ...deps, fetchImpl }).resolveBaseUrl }, { ...{ ...deps, fetchImpl } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(deps.written[0]).toBe(`${JSON.stringify({ run: { id: 'run-1', state: 'running' }, started: true })}\n`);
  });

  it('omits agentId/idempotencyKey from the body when not given', async () => {
    const deps = makeDeps();
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({ contextRef: 'ctx-1' });
      return jsonResponse(201, { ok: true });
    });
    await runStartCommand({ args: ['--context-ref', 'ctx-1'], resolveBaseUrl: ({ ...deps, fetchImpl }).resolveBaseUrl }, { ...{ ...deps, fetchImpl } });
  });

  it('accepts "-h" as a --help alias', async () => {
    const deps = makeDeps();
    const fetchImpl = vi.fn();
    await runStartCommand({ args: ['-h'], resolveBaseUrl: ({ ...deps, fetchImpl }).resolveBaseUrl }, { ...{ ...deps, fetchImpl } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('honors caller-supplied exitCodes on a missing-input error', async () => {
    const deps = exitingDeps({ exitCodes: { 'missing-input': 99 } });
    await expect(runStartCommand({ args: [], resolveBaseUrl: (deps).resolveBaseUrl }, { ...deps })).rejects.toThrow(ExitSentinel);
    expect(deps.exit).toHaveBeenCalledWith({ code: 99 });
  });

  it('defaults write/writeErr/exit/fetchImpl to their process-global counterparts when nothing is injected', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(201, { ok: true }) as Response);
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await runStartCommand({ args: ['--context-ref', 'ctx-1'], resolveBaseUrl: () => 'http://d.example' });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(stdoutSpy).toHaveBeenCalledWith(`${JSON.stringify({ ok: true })}\n`);
    } finally {
      fetchSpy.mockRestore();
      stdoutSpy.mockRestore();
    }
  });

  it('prints --help usage via process.stdout.write when no write is injected', async () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await runStartCommand({ args: ['--help'], resolveBaseUrl: () => 'http://d.example' });
      expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
    } finally {
      stdoutSpy.mockRestore();
    }
  });

  it('passes exit/exitCodes through transportOptions on a success path when both are set', async () => {
    const deps = makeDeps({ exit: vi.fn() as never, exitCodes: { custom: 5 } });
    const fetchImpl = vi.fn(async () => jsonResponse(201, { ok: true }));
    await runStartCommand({ args: ['--context-ref', 'ctx-1'], resolveBaseUrl: ({ ...deps, fetchImpl }).resolveBaseUrl }, { ...{ ...deps, fetchImpl } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('defaults writeErr/exit to process.stderr/process.exit on a structured error when nothing is injected', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number): never => {
      throw new ExitSentinel(code ?? 0);
    }) as never);
    try {
      await expect(runStartCommand({ args: [], resolveBaseUrl: () => 'http://d.example' })).rejects.toThrow(ExitSentinel);
      expect(stderrSpy).toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(DEFAULT_CLI_EXIT_CODES['missing-input']);
    } finally {
      stderrSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });
});

describe('runListCommand', () => {
  it('prints usage and returns for --help without making a request', async () => {
    const deps = makeDeps();
    const fetchImpl = vi.fn();
    await runListCommand({ args: ['--help'], resolveBaseUrl: ({ ...deps, fetchImpl }).resolveBaseUrl }, { ...{ ...deps, fetchImpl } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('GETs /api/runs with no query when contextRef is omitted', async () => {
    const deps = makeDeps();
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(url).toBe('http://d.example/api/runs');
      return jsonResponse(200, { runs: [] });
    });
    await runListCommand({ args: [], resolveBaseUrl: ({ ...deps, fetchImpl }).resolveBaseUrl }, { ...{ ...deps, fetchImpl } });
    expect(deps.written[0]).toBe(`${JSON.stringify({ runs: [] })}\n`);
  });

  it('GETs /api/runs?contextRef=<encoded> when given', async () => {
    const deps = makeDeps();
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(url).toBe('http://d.example/api/runs?contextRef=ctx%201');
      return jsonResponse(200, { runs: [{ id: 'run-1' }] });
    });
    await runListCommand({ args: ['--context-ref', 'ctx 1'], resolveBaseUrl: ({ ...deps, fetchImpl }).resolveBaseUrl }, { ...{ ...deps, fetchImpl } });
  });

  it('accepts "-h" as a --help alias', async () => {
    const deps = makeDeps();
    const fetchImpl = vi.fn();
    await runListCommand({ args: ['-h'], resolveBaseUrl: ({ ...deps, fetchImpl }).resolveBaseUrl }, { ...{ ...deps, fetchImpl } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('prints --help usage via process.stdout.write when no write is injected', async () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await runListCommand({ args: ['--help'], resolveBaseUrl: () => 'http://d.example' });
      expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
    } finally {
      stdoutSpy.mockRestore();
    }
  });
});

describe('runGetCommand', () => {
  it('prints usage and returns for --help without making a request', async () => {
    const deps = makeDeps();
    const fetchImpl = vi.fn();
    await runGetCommand({ args: ['--help'], resolveBaseUrl: ({ ...deps, fetchImpl }).resolveBaseUrl }, { ...{ ...deps, fetchImpl } });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(deps.written.join('')).toContain('Usage:');
  });

  it('exits with missing-input when runId is absent', async () => {
    const deps = exitingDeps();
    await expect(runGetCommand({ args: [], resolveBaseUrl: (deps).resolveBaseUrl }, { ...deps })).rejects.toThrow(ExitSentinel);
    expect(deps.exit).toHaveBeenCalledWith({ code: DEFAULT_CLI_EXIT_CODES['missing-input'] });
  });

  it('treats an empty-string runId the same as a missing one', async () => {
    const deps = exitingDeps();
    await expect(runGetCommand({ args: [''], resolveBaseUrl: (deps).resolveBaseUrl }, { ...deps })).rejects.toThrow(ExitSentinel);
    expect(deps.exit).toHaveBeenCalledWith({ code: DEFAULT_CLI_EXIT_CODES['missing-input'] });
  });

  it('GETs /api/runs/:runId and prints the JSON result', async () => {
    const deps = makeDeps();
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(url).toBe('http://d.example/api/runs/run-1');
      return jsonResponse(200, { run: { id: 'run-1', state: 'running' } });
    });
    await runGetCommand({ args: ['run-1'], resolveBaseUrl: ({ ...deps, fetchImpl }).resolveBaseUrl }, { ...{ ...deps, fetchImpl } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(deps.written[0]).toBe(`${JSON.stringify({ run: { id: 'run-1', state: 'running' } })}\n`);
  });

  it('URL-encodes the runId', async () => {
    const deps = makeDeps();
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(url).toBe('http://d.example/api/runs/run%2Fid');
      return jsonResponse(200, {});
    });
    await runGetCommand({ args: ['run/id'], resolveBaseUrl: ({ ...deps, fetchImpl }).resolveBaseUrl }, { ...{ ...deps, fetchImpl } });
  });

  it('accepts "-h" as a --help alias', async () => {
    const deps = makeDeps();
    const fetchImpl = vi.fn();
    await runGetCommand({ args: ['-h'], resolveBaseUrl: ({ ...deps, fetchImpl }).resolveBaseUrl }, { ...{ ...deps, fetchImpl } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('exits through the structured-error path on a non-2xx daemon response (e.g. an unknown runId)', async () => {
    const deps = exitingDeps();
    const fetchImpl = vi.fn(async () => jsonResponse(404, { error: { code: 'not-found', message: 'run "missing" was not found' } }));
    await expect(runGetCommand({ args: ['missing'], resolveBaseUrl: ({ ...deps, fetchImpl }).resolveBaseUrl }, { ...{ ...deps, fetchImpl } })).rejects.toThrow(ExitSentinel);
  });

  it('prints --help usage via process.stdout.write when no write is injected', async () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await runGetCommand({ args: ['--help'], resolveBaseUrl: () => 'http://d.example' });
      expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
    } finally {
      stdoutSpy.mockRestore();
    }
  });

  it('defaults writeErr/exit to process.stderr/process.exit on a structured error when nothing is injected', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number): never => {
      throw new ExitSentinel(code ?? 0);
    }) as never);
    try {
      await expect(runGetCommand({ args: [], resolveBaseUrl: () => 'http://d.example' })).rejects.toThrow(ExitSentinel);
      expect(stderrSpy).toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(DEFAULT_CLI_EXIT_CODES['missing-input']);
    } finally {
      stderrSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });
});

describe('runCancelCommand', () => {
  it('prints usage and returns for --help without making a request', async () => {
    const deps = makeDeps();
    const fetchImpl = vi.fn();
    await runCancelCommand({ args: ['--help'], resolveBaseUrl: ({ ...deps, fetchImpl }).resolveBaseUrl }, { ...{ ...deps, fetchImpl } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('exits with missing-input when runId is absent', async () => {
    const deps = exitingDeps();
    await expect(runCancelCommand({ args: ['--reason', 'x'], resolveBaseUrl: (deps).resolveBaseUrl }, { ...deps })).rejects.toThrow(ExitSentinel);
    expect(deps.exit).toHaveBeenCalledWith({ code: DEFAULT_CLI_EXIT_CODES['missing-input'] });
  });

  it('posts to /api/runs/:runId/cancel with an optional reason', async () => {
    const deps = makeDeps();
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(url).toBe('http://d.example/api/runs/run-1/cancel');
      expect(JSON.parse(String(init?.body))).toEqual({ reason: 'cleanup' });
      return jsonResponse(200, { run: { id: 'run-1', state: 'cancelled' } });
    });
    await runCancelCommand({ args: ['run-1', '--reason', 'cleanup'], resolveBaseUrl: ({ ...deps, fetchImpl }).resolveBaseUrl }, { ...{ ...deps, fetchImpl } });
    expect(deps.written[0]).toBe(`${JSON.stringify({ run: { id: 'run-1', state: 'cancelled' } })}\n`);
  });

  it('URL-encodes the runId', async () => {
    const deps = makeDeps();
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(url).toBe('http://d.example/api/runs/run%2Fid/cancel');
      return jsonResponse(200, {});
    });
    await runCancelCommand({ args: ['run/id'], resolveBaseUrl: ({ ...deps, fetchImpl }).resolveBaseUrl }, { ...{ ...deps, fetchImpl } });
  });

  it('accepts "-h" as a --help alias', async () => {
    const deps = makeDeps();
    const fetchImpl = vi.fn();
    await runCancelCommand({ args: ['-h'], resolveBaseUrl: ({ ...deps, fetchImpl }).resolveBaseUrl }, { ...{ ...deps, fetchImpl } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('treats an empty-string runId the same as a missing one', async () => {
    const deps = exitingDeps();
    await expect(runCancelCommand({ args: [''], resolveBaseUrl: (deps).resolveBaseUrl }, { ...deps })).rejects.toThrow(ExitSentinel);
    expect(deps.exit).toHaveBeenCalledWith({ code: DEFAULT_CLI_EXIT_CODES['missing-input'] });
  });

  it('prints --help usage via process.stdout.write when no write is injected', async () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await runCancelCommand({ args: ['--help'], resolveBaseUrl: () => 'http://d.example' });
      expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
    } finally {
      stdoutSpy.mockRestore();
    }
  });
});

describe('watchRunEvents / runWatchCommand', () => {
  it('prints usage and returns for --help without making a request', async () => {
    const deps = makeDeps();
    const fetchImpl = vi.fn();
    await runWatchCommand({ args: ['--help'], resolveBaseUrl: ({ ...deps, fetchImpl }).resolveBaseUrl }, { ...{ ...deps, fetchImpl } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('exits with missing-input when runId is absent', async () => {
    const deps = exitingDeps();
    await expect(runWatchCommand({ args: [], resolveBaseUrl: (deps).resolveBaseUrl }, { ...deps })).rejects.toThrow(ExitSentinel);
    expect(deps.exit).toHaveBeenCalledWith({ code: DEFAULT_CLI_EXIT_CODES['missing-input'] });
  });

  it('treats an empty-string runId the same as a missing one', async () => {
    const deps = exitingDeps();
    await expect(runWatchCommand({ args: [''], resolveBaseUrl: (deps).resolveBaseUrl }, { ...deps })).rejects.toThrow(ExitSentinel);
    expect(deps.exit).toHaveBeenCalledWith({ code: DEFAULT_CLI_EXIT_CODES['missing-input'] });
  });

  it('accepts "-h" as a --help alias', async () => {
    const deps = makeDeps();
    const fetchImpl = vi.fn();
    await runWatchCommand({ args: ['-h'], resolveBaseUrl: ({ ...deps, fetchImpl }).resolveBaseUrl }, { ...{ ...deps, fetchImpl } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not treat a non-JSON data line as terminal, and keeps streaming', async () => {
    const deps = makeDeps();
    const fetchImpl = vi.fn(async () =>
      sseResponse(200, ['data: not-json-at-all\n\n', sseFrame('c2', 'end')]),
    );
    await watchRunEvents({ baseUrl: 'http://d.example', runId: 'run-1', args: [] }, { ...deps, fetchImpl });
    expect(deps.written).toHaveLength(2);
    expect(deps.written[0]).toBe('not-json-at-all\n');
  });

  it('silently drops a frame with no "data:" line at all (e.g. an id/event-only heartbeat)', async () => {
    const deps = makeDeps();
    const fetchImpl = vi.fn(async () => sseResponse(200, ['id: c0\nevent: heartbeat\n\n', sseFrame('c1', 'end')]));
    await watchRunEvents({ baseUrl: 'http://d.example', runId: 'run-1', args: [] }, { ...deps, fetchImpl });
    // Only the real "end" event was written — the heartbeat-only frame produced no output.
    expect(deps.written).toHaveLength(1);
    expect(JSON.parse(deps.written[0]!)).toEqual({ kind: 'end', opaqueCursor: 'c1' });
  });

  it('sanitizes a non-Error value thrown mid-stream before exiting', async () => {
    const deps = exitingDeps();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error('a plain string stream failure');
      },
    });
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, body: stream } as unknown as Response));
    await expect(watchRunEvents({ baseUrl: 'http://d.example', runId: 'run-1', args: [] }, { ...deps, fetchImpl })).rejects.toThrow(ExitSentinel);
    expect(deps.exit).toHaveBeenCalledWith({ code: DEFAULT_CLI_EXIT_CODES['daemon-not-running'] });
    const combined = deps.errWritten.join('');
    expect(combined).toContain('a plain string stream failure');
  });

  it('prints --help usage via process.stdout.write when no write is injected', async () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await runWatchCommand({ args: ['--help'], resolveBaseUrl: () => 'http://d.example' });
      expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
    } finally {
      stdoutSpy.mockRestore();
    }
  });

  it('defaults fetchImpl/write to the global fetch/process.stdout when nothing is injected', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(sseResponse(200, [sseFrame('c1', 'end')]) as Response);
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await watchRunEvents({ baseUrl: 'http://d.example', runId: 'run-1', args: [] }, {} as RunCommandDeps);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(stdoutSpy).toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
      stdoutSpy.mockRestore();
    }
  });

  it('streams one NDJSON line per event and stops at a terminal "end" event', async () => {
    const deps = makeDeps();
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(url).toBe('http://d.example/api/runs/run-1/events');
      return sseResponse(200, [sseFrame('c1', 'agent', { data: { text: 'hi' } }), sseFrame('c2', 'end')]);
    });
    await runWatchCommand({ args: ['run-1'], resolveBaseUrl: ({ ...deps, fetchImpl }).resolveBaseUrl }, { ...{ ...deps, fetchImpl } });
    expect(deps.written).toHaveLength(2);
    expect(JSON.parse(deps.written[0]!)).toEqual({ kind: 'agent', opaqueCursor: 'c1', data: { text: 'hi' } });
    expect(JSON.parse(deps.written[1]!)).toEqual({ kind: 'end', opaqueCursor: 'c2' });
  });

  it('sends Last-Event-ID when --after-cursor is given', async () => {
    const deps = makeDeps();
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>)['last-event-id']).toBe('c1');
      return sseResponse(200, [sseFrame('c2', 'end')]);
    });
    await runWatchCommand({ args: ['run-1', '--after-cursor', 'c1'], resolveBaseUrl: ({ ...deps, fetchImpl }).resolveBaseUrl }, { ...{ ...deps, fetchImpl } });
  });

  it('strips terminal control sequences from event data before writing', async () => {
    const deps = makeDeps();
    const escaped = '[31mred[0m';
    const fetchImpl = vi.fn(async () =>
      sseResponse(200, [`data: ${JSON.stringify({ kind: 'end', text: escaped })}\n\n`]),
    );
    await watchRunEvents({ baseUrl: 'http://d.example', runId: 'run-1', args: [] }, { ...deps, fetchImpl });
    expect(deps.written[0]).not.toContain('');
    expect(deps.written[0]).toContain('red');
  });

  it('exits via the structured-error path on a non-ok response', async () => {
    const deps = exitingDeps();
    const fetchImpl = vi.fn(async () => jsonResponse(404, { error: { code: 'not-found', message: 'no such run' } }));
    await expect(watchRunEvents({ baseUrl: 'http://d.example', runId: 'missing', args: [] }, { ...deps, fetchImpl })).rejects.toThrow(ExitSentinel);
  });

  it('exits via the structured-error path when the stream never terminates a frame within the buffer cap', async () => {
    const deps = exitingDeps();
    const hugeChunk = new TextEncoder().encode('x'.repeat(11 * 1024 * 1024));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(hugeChunk);
        controller.close();
      },
    });
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, body: stream } as unknown as Response));
    await expect(watchRunEvents({ baseUrl: 'http://d.example', runId: 'run-1', args: [] }, { ...deps, fetchImpl })).rejects.toThrow(ExitSentinel);
    expect(deps.exit).toHaveBeenCalledWith({ code: DEFAULT_CLI_EXIT_CODES['daemon-not-running'] });
  });

  it('stops cleanly if the stream closes without ever sending a terminal event', async () => {
    const deps = makeDeps();
    const fetchImpl = vi.fn(async () => sseResponse(200, [sseFrame('c1', 'agent')]));
    await watchRunEvents({ baseUrl: 'http://d.example', runId: 'run-1', args: [] }, { ...deps, fetchImpl });
    expect(deps.written).toHaveLength(1);
  });
});

describe('registerRunCommands', () => {
  it('dispatches "run list" to runListCommand', async () => {
    const deps = makeDeps();
    const registry = new CommandRegistry();
    const fetchImpl = vi.fn(async () => jsonResponse(200, { ok: true }));
    registerRunCommands({ registry, resolveBaseUrl: ({ ...deps, fetchImpl }).resolveBaseUrl }, { ...{ ...deps, fetchImpl } });

    await registry.dispatch({ argv: ['run', 'list'] });
    expect(fetchImpl).toHaveBeenCalledWith('http://d.example/api/runs', expect.anything());
  });

  it('dispatches "run start" to runStartCommand', async () => {
    const deps = makeDeps();
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({ contextRef: 'ctx-1' });
      return jsonResponse(201, { ok: true });
    });
    const registry = new CommandRegistry();
    registerRunCommands({ registry, resolveBaseUrl: ({ ...deps, fetchImpl }).resolveBaseUrl }, { ...{ ...deps, fetchImpl } });
    await registry.dispatch({ argv: ['run', 'start', '--context-ref', 'ctx-1'] });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('prints root run usage for a bare "run" with no subcommand', async () => {
    const deps = makeDeps();
    const registry = new CommandRegistry();
    registerRunCommands({ registry, resolveBaseUrl: (deps).resolveBaseUrl }, { ...deps });
    await registry.dispatch({ argv: ['run'] });
    expect(deps.written.join('')).toContain('Usage:');
  });

  it('prints root run usage for "run --help"', async () => {
    const deps = makeDeps();
    const registry = new CommandRegistry();
    registerRunCommands({ registry, resolveBaseUrl: (deps).resolveBaseUrl }, { ...deps });
    await registry.dispatch({ argv: ['run', '--help'] });
    expect(deps.written.join('')).toContain('Usage:');
  });

  it('prints root run usage for "run -h"', async () => {
    const deps = makeDeps();
    const registry = new CommandRegistry();
    registerRunCommands({ registry, resolveBaseUrl: (deps).resolveBaseUrl }, { ...deps });
    await registry.dispatch({ argv: ['run', '-h'] });
    expect(deps.written.join('')).toContain('Usage:');
  });

  it('dispatches "run get" to runGetCommand', async () => {
    const deps = makeDeps();
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(url).toBe('http://d.example/api/runs/run-1');
      return jsonResponse(200, { run: { id: 'run-1' } });
    });
    const registry = new CommandRegistry();
    registerRunCommands({ registry, resolveBaseUrl: ({ ...deps, fetchImpl }).resolveBaseUrl }, { ...{ ...deps, fetchImpl } });
    await registry.dispatch({ argv: ['run', 'get', 'run-1'] });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('dispatches "run cancel" to runCancelCommand', async () => {
    const deps = makeDeps();
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(url).toBe('http://d.example/api/runs/run-1/cancel');
      return jsonResponse(200, { ok: true });
    });
    const registry = new CommandRegistry();
    registerRunCommands({ registry, resolveBaseUrl: ({ ...deps, fetchImpl }).resolveBaseUrl }, { ...{ ...deps, fetchImpl } });
    await registry.dispatch({ argv: ['run', 'cancel', 'run-1'] });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('dispatches "run watch" to runWatchCommand', async () => {
    const deps = makeDeps();
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(url).toBe('http://d.example/api/runs/run-1/events');
      return sseResponse(200, [sseFrame('c1', 'end')]);
    });
    const registry = new CommandRegistry();
    registerRunCommands({ registry, resolveBaseUrl: ({ ...deps, fetchImpl }).resolveBaseUrl }, { ...{ ...deps, fetchImpl } });
    await registry.dispatch({ argv: ['run', 'watch', 'run-1'] });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('exits with invalid-flag for an unknown "run" subcommand', async () => {
    const deps = exitingDeps();
    const registry = new CommandRegistry();
    registerRunCommands({ registry, resolveBaseUrl: (deps).resolveBaseUrl }, { ...deps });
    await expect(registry.dispatch({ argv: ['run', 'bogus'] })).rejects.toThrow(ExitSentinel);
    expect(deps.exit).toHaveBeenCalledWith({ code: DEFAULT_CLI_EXIT_CODES['invalid-flag'] });
  });

  it('prints root run usage via process.stdout.write when no write is injected', async () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const registry = new CommandRegistry();
      registerRunCommands({ registry, resolveBaseUrl: () => 'http://d.example' });
      await registry.dispatch({ argv: ['run'] });
      expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
    } finally {
      stdoutSpy.mockRestore();
    }
  });
});
