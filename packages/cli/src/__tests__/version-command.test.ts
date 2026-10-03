import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CLI_EXIT_CODES } from '../errors.js';
import { CommandRegistry } from '../command-registry.js';
import { registerVersionCommand, versionCommand, type VersionCommandDeps } from '../version-command.js';

class ExitSentinel extends Error {
  constructor(public code: number) {
    super(`exit ${code}`);
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}

function makeDeps(overrides: Partial<VersionCommandDeps> = {}): VersionCommandDeps & { written: string[]; errWritten: string[] } {
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

function exitingDeps(overrides: Partial<VersionCommandDeps> = {}) {
  const deps = makeDeps(overrides);
  const exit = vi.fn(({ code }: { code: number }): never => { throw new ExitSentinel(code); });
  return { ...deps, exit };
}

describe('versionCommand', () => {
  it('prints --help usage via process.stdout.write when no write is injected', async () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await versionCommand({ args: ['--help'], resolveBaseUrl: () => 'http://d.example' });
      expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
    } finally {
      stdoutSpy.mockRestore();
    }
  });

  it('prints usage and returns for --help without making a request', async () => {
    const deps = makeDeps();
    const fetchImpl = vi.fn();
    await versionCommand({ args: ['--help'], resolveBaseUrl: ({ ...deps, fetchImpl }).resolveBaseUrl }, { ...{ ...deps, fetchImpl } });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(deps.written.join('')).toContain('Usage:');
  });

  it('prints usage and returns for -h without making a request', async () => {
    const deps = makeDeps();
    const fetchImpl = vi.fn();
    await versionCommand({ args: ['-h'], resolveBaseUrl: ({ ...deps, fetchImpl }).resolveBaseUrl }, { ...{ ...deps, fetchImpl } });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(deps.written.join('')).toContain('Usage:');
  });

  it('GETs /api/daemon/status and prints only the version string, not the full envelope', async () => {
    const deps = makeDeps();
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe('http://d.example/api/daemon/status');
      return jsonResponse(200, { ok: true, version: '1.2.3', host: '127.0.0.1', port: 7456, dataDir: '/data', shuttingDown: false, pid: 42 });
    });
    await versionCommand({ args: [], resolveBaseUrl: ({ ...deps, fetchImpl }).resolveBaseUrl }, { ...{ ...deps, fetchImpl } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(deps.written[0]).toBe('1.2.3\n');
  });

  it('resolves the base URL fresh on every invocation', async () => {
    const resolveBaseUrl = vi.fn(() => 'http://d.example');
    const deps = makeDeps({ resolveBaseUrl });
    const fetchImpl = vi.fn(async () => jsonResponse(200, { version: '1.0.0' }));
    await versionCommand({ args: [], resolveBaseUrl: ({ ...deps, fetchImpl }).resolveBaseUrl }, { ...{ ...deps, fetchImpl } });
    await versionCommand({ args: [], resolveBaseUrl: ({ ...deps, fetchImpl }).resolveBaseUrl }, { ...{ ...deps, fetchImpl } });
    expect(resolveBaseUrl).toHaveBeenCalledTimes(2);
  });

  it('exits through the structured-error path on a non-2xx daemon response', async () => {
    const deps = exitingDeps();
    const fetchImpl = vi.fn(async () => jsonResponse(500, {}));
    await expect(versionCommand({ args: [], resolveBaseUrl: ({ ...deps, fetchImpl }).resolveBaseUrl }, { ...{ ...deps, fetchImpl } })).rejects.toThrow(ExitSentinel);
  });

  it('exits with daemon-not-running when the response has no version field', async () => {
    const deps = exitingDeps();
    const fetchImpl = vi.fn(async () => jsonResponse(200, { ok: true }));
    await expect(versionCommand({ args: [], resolveBaseUrl: ({ ...deps, fetchImpl }).resolveBaseUrl }, { ...{ ...deps, fetchImpl } })).rejects.toThrow(ExitSentinel);
    expect(deps.exit).toHaveBeenCalledWith({ code: DEFAULT_CLI_EXIT_CODES['daemon-not-running'] });
  });

  it('exits with daemon-not-running when version is present but not a string', async () => {
    const deps = exitingDeps();
    const fetchImpl = vi.fn(async () => jsonResponse(200, { version: 42 }));
    await expect(versionCommand({ args: [], resolveBaseUrl: ({ ...deps, fetchImpl }).resolveBaseUrl }, { ...{ ...deps, fetchImpl } })).rejects.toThrow(ExitSentinel);
    expect(deps.exit).toHaveBeenCalledWith({ code: DEFAULT_CLI_EXIT_CODES['daemon-not-running'] });
  });

  it('exits with daemon-not-running when version is an empty string', async () => {
    const deps = exitingDeps();
    const fetchImpl = vi.fn(async () => jsonResponse(200, { version: '' }));
    await expect(versionCommand({ args: [], resolveBaseUrl: ({ ...deps, fetchImpl }).resolveBaseUrl }, { ...{ ...deps, fetchImpl } })).rejects.toThrow(ExitSentinel);
    expect(deps.exit).toHaveBeenCalledWith({ code: DEFAULT_CLI_EXIT_CODES['daemon-not-running'] });
  });

  it('exits with daemon-not-running when the response body is not an object (e.g. a bare string)', async () => {
    const deps = exitingDeps();
    const fetchImpl = vi.fn(async () => jsonResponse(200, 'not-an-object' as unknown as Record<string, unknown>));
    await expect(versionCommand({ args: [], resolveBaseUrl: ({ ...deps, fetchImpl }).resolveBaseUrl }, { ...{ ...deps, fetchImpl } })).rejects.toThrow(ExitSentinel);
    expect(deps.exit).toHaveBeenCalledWith({ code: DEFAULT_CLI_EXIT_CODES['daemon-not-running'] });
  });

  it('honors a caller-supplied exitCodes table on the missing-version path', async () => {
    const deps = exitingDeps({ exitCodes: { 'daemon-not-running': 88 } });
    const fetchImpl = vi.fn(async () => jsonResponse(200, {}));
    await expect(versionCommand({ args: [], resolveBaseUrl: ({ ...deps, fetchImpl }).resolveBaseUrl }, { ...{ ...deps, fetchImpl } })).rejects.toThrow(ExitSentinel);
    expect(deps.exit).toHaveBeenCalledWith({ code: 88 });
  });

  it('defaults writeErr/exit to process.stderr/process.exit on a structured error when nothing is injected', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number): never => {
      throw new ExitSentinel(code ?? 0);
    }) as never);
    const fetchImpl = vi.fn(async () => jsonResponse(500, {}));
    try {
      await expect(versionCommand({ args: [], resolveBaseUrl: ({ resolveBaseUrl: () => 'http://d.example', fetchImpl }).resolveBaseUrl }, { ...{ resolveBaseUrl: () => 'http://d.example', fetchImpl } })).rejects.toThrow(ExitSentinel);
      expect(stderrSpy).toHaveBeenCalled();
    } finally {
      stderrSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  it('defaults writeErr/exit to process.stderr/process.exit on the missing-version path when nothing is injected', async () => {
    // Distinct from the "non-2xx daemon response" default-fallback case above: a 500 response is
    // handled entirely inside http.ts's own requestJsonFromDaemon (its own default write/exit
    // fallback, not this file's), so it never reaches extractVersion's own exitWithStructuredError
    // call. Only a 2xx response missing `version` reaches this file's own errorOptions/defaultWriteErr.
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number): never => {
      throw new ExitSentinel(code ?? 0);
    }) as never);
    const fetchImpl = vi.fn(async () => jsonResponse(200, { ok: true }));
    try {
      await expect(versionCommand({ args: [], resolveBaseUrl: ({ resolveBaseUrl: () => 'http://d.example', fetchImpl }).resolveBaseUrl }, { ...{ resolveBaseUrl: () => 'http://d.example', fetchImpl } })).rejects.toThrow(ExitSentinel);
      expect(stderrSpy).toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(DEFAULT_CLI_EXIT_CODES['daemon-not-running']);
    } finally {
      stderrSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  it('defaults fetchImpl/write to the global fetch/process.stdout when nothing is injected', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(200, { version: '9.9.9' }) as Response);
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await versionCommand({ args: [], resolveBaseUrl: () => 'http://d.example' });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(stdoutSpy).toHaveBeenCalledWith('9.9.9\n');
    } finally {
      fetchSpy.mockRestore();
      stdoutSpy.mockRestore();
    }
  });

  it('passes exit/exitCodes through transportOptions on a success path when both are set', async () => {
    const deps = makeDeps({ exit: vi.fn() as never, exitCodes: { custom: 5 } });
    const fetchImpl = vi.fn(async () => jsonResponse(200, { version: '1.0.0' }));
    await versionCommand({ args: [], resolveBaseUrl: ({ ...deps, fetchImpl }).resolveBaseUrl }, { ...{ ...deps, fetchImpl } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('registerVersionCommand', () => {
  it('dispatches "version" to versionCommand', async () => {
    const registry = new CommandRegistry();
    const deps = makeDeps();
    const fetchImpl = vi.fn(async () => jsonResponse(200, { version: '1.2.3' }));
    registerVersionCommand({ registry, resolveBaseUrl: ({ ...deps, fetchImpl }).resolveBaseUrl }, { ...{ ...deps, fetchImpl } });

    await registry.dispatch({ argv: ['version'] });
    expect(fetchImpl).toHaveBeenCalledWith('http://d.example/api/daemon/status', expect.anything());
    expect(deps.written[0]).toBe('1.2.3\n');
  });

  it('registers usage text against the registry', () => {
    const registry = new CommandRegistry();
    registerVersionCommand({ registry, resolveBaseUrl: (makeDeps()).resolveBaseUrl }, { ...makeDeps() });
    expect(registry.usageFor({ name: 'version' })).toContain('Usage:');
  });
});
