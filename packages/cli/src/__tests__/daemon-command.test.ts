import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CLI_EXIT_CODES } from '../errors.js';
import { CommandRegistry } from '../command-registry.js';
import {
  daemonStatusCommand,
  daemonStopCommand,
  registerDaemonCommands,
  type DaemonCommandDeps,
} from '../daemon-command.js';

class ExitSentinel extends Error {
  constructor(public code: number) {
    super(`exit ${code}`);
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}

function makeDeps(overrides: Partial<DaemonCommandDeps> = {}): DaemonCommandDeps & { written: string[]; errWritten: string[] } {
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

function exitingDeps(overrides: Partial<DaemonCommandDeps> = {}) {
  const deps = makeDeps(overrides);
  const exit = vi.fn(({ code }: { code: number }): never => { throw new ExitSentinel(code); });
  return { ...deps, exit };
}

describe('daemonStatusCommand', () => {
  it('prints --help usage via process.stdout.write when no write is injected', async () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await daemonStatusCommand({ args: ['--help'], resolveBaseUrl: () => 'http://d.example' });
      expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
    } finally {
      stdoutSpy.mockRestore();
    }
  });

  it('prints usage and returns for --help without making a request', async () => {
    const deps = makeDeps();
    const fetchImpl = vi.fn();
    await daemonStatusCommand({ args: ['--help'], resolveBaseUrl: ({ ...deps, fetchImpl }).resolveBaseUrl }, { ...{ ...deps, fetchImpl } });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(deps.written.join('')).toContain('Usage:');
  });

  it('prints usage and returns for -h without making a request', async () => {
    const deps = makeDeps();
    const fetchImpl = vi.fn();
    await daemonStatusCommand({ args: ['-h'], resolveBaseUrl: ({ ...deps, fetchImpl }).resolveBaseUrl }, { ...{ ...deps, fetchImpl } });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(deps.written.join('')).toContain('Usage:');
  });

  it('GETs /api/daemon/status and prints the JSON result', async () => {
    const deps = makeDeps();
    const statusBody = { ok: true, version: '1.2.3', host: '127.0.0.1', port: 7456, dataDir: '/data', shuttingDown: false, pid: 42 };
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe('http://d.example/api/daemon/status');
      return jsonResponse(200, statusBody);
    });
    await daemonStatusCommand({ args: [], resolveBaseUrl: ({ ...deps, fetchImpl }).resolveBaseUrl }, { ...{ ...deps, fetchImpl } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(deps.written[0]).toBe(`${JSON.stringify(statusBody)}\n`);
  });

  it('resolves the base URL fresh on every invocation', async () => {
    const resolveBaseUrl = vi.fn(() => 'http://d.example');
    const deps = makeDeps({ resolveBaseUrl });
    const fetchImpl = vi.fn(async () => jsonResponse(200, { ok: true }));
    await daemonStatusCommand({ args: [], resolveBaseUrl: ({ ...deps, fetchImpl }).resolveBaseUrl }, { ...{ ...deps, fetchImpl } });
    await daemonStatusCommand({ args: [], resolveBaseUrl: ({ ...deps, fetchImpl }).resolveBaseUrl }, { ...{ ...deps, fetchImpl } });
    expect(resolveBaseUrl).toHaveBeenCalledTimes(2);
  });

  it('exits through the structured-error path on a non-2xx daemon response', async () => {
    const deps = exitingDeps();
    const fetchImpl = vi.fn(async () => jsonResponse(500, {}));
    await expect(daemonStatusCommand({ args: [], resolveBaseUrl: ({ ...deps, fetchImpl }).resolveBaseUrl }, { ...{ ...deps, fetchImpl } })).rejects.toThrow(ExitSentinel);
  });

  it('defaults writeErr/exit to process.stderr/process.exit on a structured error when nothing is injected', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number): never => {
      throw new ExitSentinel(code ?? 0);
    }) as never);
    const fetchImpl = vi.fn(async () => jsonResponse(500, {}));
    try {
      await expect(daemonStatusCommand({ args: [], resolveBaseUrl: ({ resolveBaseUrl: () => 'http://d.example', fetchImpl }).resolveBaseUrl }, { ...{ resolveBaseUrl: () => 'http://d.example', fetchImpl } })).rejects.toThrow(ExitSentinel);
      expect(stderrSpy).toHaveBeenCalled();
    } finally {
      stderrSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  it('defaults fetchImpl/write to the global fetch/process.stdout when nothing is injected', async () => {
    const statusBody = { ok: true, version: '1.2.3', host: '127.0.0.1', port: 7456, dataDir: '/data', shuttingDown: false, pid: 42 };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(200, statusBody) as Response);
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await daemonStatusCommand({ args: [], resolveBaseUrl: () => 'http://d.example' });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(stdoutSpy).toHaveBeenCalledWith(`${JSON.stringify(statusBody)}\n`);
    } finally {
      fetchSpy.mockRestore();
      stdoutSpy.mockRestore();
    }
  });

  it('passes exit/exitCodes through transportOptions on a success path when both are set', async () => {
    const deps = makeDeps({ exit: vi.fn() as never, exitCodes: { custom: 5 } });
    const fetchImpl = vi.fn(async () => jsonResponse(200, { ok: true }));
    await daemonStatusCommand({ args: [], resolveBaseUrl: ({ ...deps, fetchImpl }).resolveBaseUrl }, { ...{ ...deps, fetchImpl } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('daemonStopCommand', () => {
  it('prints --help usage via process.stdout.write when no write is injected', async () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await daemonStopCommand({ args: ['--help'], resolveBaseUrl: () => 'http://d.example' });
      expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
    } finally {
      stdoutSpy.mockRestore();
    }
  });

  it('prints usage and returns for --help without making a request', async () => {
    const deps = makeDeps();
    const fetchImpl = vi.fn();
    await daemonStopCommand({ args: ['--help'], resolveBaseUrl: ({ ...deps, fetchImpl }).resolveBaseUrl }, { ...{ ...deps, fetchImpl } });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(deps.written.join('')).toContain('Usage:');
  });

  it('POSTs an empty body to /api/daemon/shutdown and prints the JSON result', async () => {
    const deps = makeDeps();
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('http://d.example/api/daemon/shutdown');
      expect(init?.method).toBe('POST');
      expect(JSON.parse(String(init?.body))).toEqual({});
      return jsonResponse(200, { ok: true, scheduled: true });
    });
    await daemonStopCommand({ args: [], resolveBaseUrl: ({ ...deps, fetchImpl }).resolveBaseUrl }, { ...{ ...deps, fetchImpl } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(deps.written[0]).toBe(`${JSON.stringify({ ok: true, scheduled: true })}\n`);
  });

  it('exits through the structured-error path when the daemon rejects the shutdown request', async () => {
    const deps = exitingDeps();
    const fetchImpl = vi.fn(async () => jsonResponse(403, { error: { code: 'FORBIDDEN', message: 'cross-origin request rejected' } }));
    await expect(daemonStopCommand({ args: [], resolveBaseUrl: ({ ...deps, fetchImpl }).resolveBaseUrl }, { ...{ ...deps, fetchImpl } })).rejects.toThrow(ExitSentinel);
  });
});

describe('registerDaemonCommands', () => {
  it('dispatches "status" and "stop" subcommands', async () => {
    const registry = new CommandRegistry();
    const deps = makeDeps();
    const fetchImpl = vi.fn(async () => jsonResponse(200, { ok: true }));
    registerDaemonCommands({ registry, resolveBaseUrl: ({ ...deps, fetchImpl }).resolveBaseUrl }, { ...{ ...deps, fetchImpl } });

    await registry.dispatch({ argv: ['daemon', 'status'] });
    expect(fetchImpl).toHaveBeenCalledWith('http://d.example/api/daemon/status', expect.anything());

    fetchImpl.mockClear();
    await registry.dispatch({ argv: ['daemon', 'stop'] });
    expect(fetchImpl).toHaveBeenCalledWith('http://d.example/api/daemon/shutdown', expect.anything());
  });

  it('prints root usage for no subcommand, --help, and -h', async () => {
    const registry = new CommandRegistry();
    const deps = makeDeps();
    registerDaemonCommands({ registry, resolveBaseUrl: (deps).resolveBaseUrl }, { ...deps });

    await registry.dispatch({ argv: ['daemon'] });
    await registry.dispatch({ argv: ['daemon', '--help'] });
    await registry.dispatch({ argv: ['daemon', '-h'] });
    expect(deps.written.filter((line) => line.includes('Usage:')).length).toBe(3);
  });

  it('prints root usage via process.stdout.write when no write is injected', async () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const registry = new CommandRegistry();
      registerDaemonCommands({ registry, resolveBaseUrl: () => 'http://d.example' });
      await registry.dispatch({ argv: ['daemon'] });
      expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
    } finally {
      stdoutSpy.mockRestore();
    }
  });

  it('exits with invalid-flag on an unknown subcommand', async () => {
    const registry = new CommandRegistry();
    const deps = exitingDeps();
    registerDaemonCommands({ registry, resolveBaseUrl: (deps).resolveBaseUrl }, { ...deps });
    await expect(registry.dispatch({ argv: ['daemon', 'bogus'] })).rejects.toThrow(ExitSentinel);
    expect(deps.exit).toHaveBeenCalledWith({ code: DEFAULT_CLI_EXIT_CODES['invalid-flag'] });
  });

  it('passes a caller-supplied exitCodes table through errorOptions on an unknown subcommand', async () => {
    const registry = new CommandRegistry();
    const deps = exitingDeps({ exitCodes: { 'invalid-flag': 77 } });
    registerDaemonCommands({ registry, resolveBaseUrl: (deps).resolveBaseUrl }, { ...deps });
    await expect(registry.dispatch({ argv: ['daemon', 'bogus'] })).rejects.toThrow(ExitSentinel);
    expect(deps.exit).toHaveBeenCalledWith({ code: 77 });
  });

  it('defaults writeErr/exit to process.stderr/process.exit on an unknown subcommand when nothing is injected', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number): never => {
      throw new ExitSentinel(code ?? 0);
    }) as never);
    const registry = new CommandRegistry();
    registerDaemonCommands({ registry, resolveBaseUrl: () => 'http://d.example' });
    try {
      await expect(registry.dispatch({ argv: ['daemon', 'bogus'] })).rejects.toThrow(ExitSentinel);
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('bogus'));
      expect(exitSpy).toHaveBeenCalledWith(DEFAULT_CLI_EXIT_CODES['invalid-flag']);
    } finally {
      stderrSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });
});
