import { mockState, withPlatformAsync } from './process-fixtures.js';
import { describe, expect, it, vi } from 'vitest';
import { listProcessSnapshots, listProcessUsage, parseProcessFootprint, sampleProcessPrivateMemory } from '../process.js';

const POWERSHELL_PATH = /^[A-Za-z]:\\.*\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe$/i;

describe('@jini-ai/platform — process — listProcessSnapshots (POSIX)', () => {
  it('enumerates real running processes via ps, including the current test process', async () => {
    if (process.platform === 'win32') return;
    const snapshots = await listProcessSnapshots();
    expect(snapshots.length).toBeGreaterThan(0);
    expect(snapshots.some((snapshot) => snapshot.pid === process.pid)).toBe(true);
  });

  it('filters out lines that do not match the pid/ppid/command shape', async () => {
    mockState.execFileImpl = (_command, _args, _options, callback) => {
      const stdout = ['  123   1   /bin/real-thing', 'not-a-valid-line', '', '  456   123   another-process --flag'].join(
        '\n',
      );
      callback(null, stdout, '');
    };
    await expect(listProcessSnapshots()).resolves.toEqual([
      { command: '/bin/real-thing', pid: 123, ppid: 1 },
      { command: 'another-process --flag', pid: 456, ppid: 123 },
    ]);
  });

  it('returns an empty list when the ps call fails', async () => {
    mockState.execFileImpl = (_command, _args, _options, callback) => callback(new Error('ps not found'), '', '');
    await expect(listProcessSnapshots()).resolves.toEqual([]);
  });
});

describe('@jini-ai/platform — process — listProcessSnapshots (Windows)', () => {
  it('read-only desktop enumeration retains live identities without command lines or usage metrics', async () => {
    const run = vi.fn(async () => ({ code: undefined, error: null, ok: true, stderr: '', stdout: JSON.stringify([
      { ProcessId: 101, ParentProcessId: 1, Name: 'node.exe', CommandLine: 'must-never-be-returned' },
      { ProcessId: 102, ParentProcessId: 101, Name: null },
    ]) }));
    await expect(listProcessSnapshots({ platform: 'win32', run }, { commandLines: false, timeoutMs: 250 })).resolves.toEqual([
      { pid: 101, ppid: 1, command: 'node.exe' }, { pid: 102, ppid: 101, command: '' },
    ]);
    expect(run).toHaveBeenCalledWith(expect.stringMatching(POWERSHELL_PATH), expect.arrayContaining([
      "$ErrorActionPreference = 'Stop'; Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name | ConvertTo-Json -Compress",
    ]), expect.objectContaining({ timeout: 250 }));
  });

  it('wraps a single (non-array) Get-CimInstance JSON object into a one-element list', async () => {
    mockState.execFileImpl = (_command, _args, _options, callback) => {
      callback(null, JSON.stringify({ CommandLine: 'C:\\node.exe app.js', ParentProcessId: 1, ProcessId: 100 }), '');
    };
    await expect(withPlatformAsync('win32', () => listProcessSnapshots())).resolves.toEqual([
      { command: 'C:\\node.exe app.js', pid: 100, ppid: 1 },
    ]);
  });

  it('parses an array of records, filtering out ones with blank/missing CommandLine or a non-numeric id', async () => {
    mockState.execFileImpl = (_command, _args, _options, callback) => {
      const records = [
        { CommandLine: 'C:\\a.exe', ParentProcessId: '1', ProcessId: '200' },
        { CommandLine: '   ', ParentProcessId: 1, ProcessId: 201 },
        { CommandLine: 'C:\\b.exe', ParentProcessId: 1, ProcessId: 'not-a-number' },
        { CommandLine: null, ParentProcessId: 1, ProcessId: 202 },
      ];
      callback(null, JSON.stringify(records), '');
    };
    await expect(withPlatformAsync('win32', () => listProcessSnapshots())).resolves.toEqual([
      { command: 'C:\\a.exe', pid: 200, ppid: 1 },
    ]);
  });

  it('returns an empty list for blank stdout', async () => {
    mockState.execFileImpl = (_command, _args, _options, callback) => callback(null, '   \n', '');
    await expect(withPlatformAsync('win32', () => listProcessSnapshots())).resolves.toEqual([]);
  });

  it('returns an empty list when the powershell call fails', async () => {
    mockState.execFileImpl = (_command, _args, _options, callback) => callback(new Error('powershell missing'), '', '');
    await expect(withPlatformAsync('win32', () => listProcessSnapshots())).resolves.toEqual([]);
  });
});

describe('@jini-ai/platform — process — listProcessUsage', () => {
  it('converts macOS RSS and CPU formats, preserving spaces in executable basenames', async () => {
    mockState.execFileImpl = (command, args, options, callback) => {
      expect(command).toBe('ps');
      expect(args).toEqual(['-axo', 'pid=,ppid=,rss=,time=,comm=']);
      expect(options).toEqual({ encoding: 'utf8', timeout: 5000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
      callback(null, [
        '  123 1 2048 02:03.45 /usr/local/bin/node',
        '  124 123 512 01:02:03 /Applications/Browser.app/Contents/MacOS/Browser Helper',
        '  125 123 0 2-03:04:05 /bin/worker',
      ].join('\n'), '');
    };
    await expect(listProcessUsage({ platform: 'darwin' })).resolves.toEqual([
      { pid: 123, ppid: 1, rssBytes: 2097152, cpuSeconds: 123.45, name: 'node' },
      { pid: 124, ppid: 123, rssBytes: 524288, cpuSeconds: 3723, name: 'Browser Helper' },
      { pid: 125, ppid: 123, rssBytes: 0, cpuSeconds: 183845, name: 'worker' },
    ]);
  });

  it('uses the same ps fields on Linux and ignores malformed rows without losing valid rows', async () => {
    mockState.execFileImpl = (_command, _args, _options, callback) => callback(null, [
      '  42 0 1 00:00:01 /usr/bin/worker',
      'bad row', '  43 1 12 invalid /bin/worker', '  44 1 -1 00:00:01 /bin/worker',
      '  99999999999999999999 1 12 00:00:01 /bin/worker', '',
    ].join('\r\n'), '');
    await expect(listProcessUsage({ platform: 'linux' })).resolves.toEqual([
      { pid: 42, ppid: 0, rssBytes: 1024, cpuSeconds: 1, name: 'worker' },
    ]);
  });

  const cimRecord = {
    ProcessId: 100, ParentProcessId: 1, WorkingSetSize: '1048576',
    UserModeTime: '20000000', KernelModeTime: '15000000', Name: 'C:\\Program Files\\Runtime\\node.exe',
    CommandLine: 'node.exe --token=must-never-be-returned',
  };

  it('converts a single CIM object with byte RSS and 100ns CPU counters, exposing only its basename', async () => {
    mockState.execFileImpl = (command, args, _options, callback) => {
      // Resolved under System32 rather than through the cwd-first Windows command search.
      expect(command).toMatch(POWERSHELL_PATH);
      expect(args).toEqual(['-NoProfile', '-NonInteractive', '-Command',
        "$ErrorActionPreference = 'Stop'; Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, WorkingSetSize, UserModeTime, KernelModeTime, Name | ConvertTo-Json -Compress"]);
      callback(null, JSON.stringify(cimRecord), '');
    };
    await expect(listProcessUsage({ platform: 'win32' })).resolves.toEqual([
      { pid: 100, ppid: 1, rssBytes: 1048576, cpuSeconds: 3.5, name: 'node.exe' },
    ]);
  });

  it('handles CIM arrays, numeric counters and null names without falling back to command lines', async () => {
    mockState.execFileImpl = (_command, _args, _options, callback) => callback(null, JSON.stringify([
      cimRecord,
      { ...cimRecord, ProcessId: '101', WorkingSetSize: 0, UserModeTime: 0, KernelModeTime: 0, Name: null },
    ]), '');
    await expect(listProcessUsage({ platform: 'win32' })).resolves.toEqual([
      { pid: 100, ppid: 1, rssBytes: 1048576, cpuSeconds: 3.5, name: 'node.exe' },
      { pid: 101, ppid: 1, rssBytes: 0, cpuSeconds: 0, name: '' },
    ]);
  });

  it('drops incomplete or invalid CIM metrics while retaining valid records', async () => {
    mockState.execFileImpl = (_command, _args, _options, callback) => callback(null, JSON.stringify([
      null, {}, { ...cimRecord, ProcessId: 'bad' }, { ...cimRecord, ParentProcessId: null },
      { ...cimRecord, WorkingSetSize: null }, { ...cimRecord, WorkingSetSize: -1 },
      { ...cimRecord, UserModeTime: '' }, { ...cimRecord, KernelModeTime: 'Infinity' }, cimRecord,
    ]), '');
    await expect(listProcessUsage({ platform: 'win32' })).resolves.toEqual([
      { pid: 100, ppid: 1, rssBytes: 1048576, cpuSeconds: 3.5, name: 'node.exe' },
    ]);
  });

  it.each(['', '   \n', 'null', '[]', '{broken'])('returns [] for absent or malformed CIM output %j', async (stdout) => {
    mockState.execFileImpl = (_command, _args, _options, callback) => callback(null, stdout, '');
    await expect(listProcessUsage({ platform: 'win32' })).resolves.toEqual([]);
  });

  it.each(['darwin', 'win32'] as const)('returns [] on %s execution failure, even with partial output', async (platform) => {
    mockState.execFileImpl = (_command, _args, _options, callback) => {
      callback(new Error('timeout or output limit'), '42 1 1024 00:01 /bin/worker', '');
    };
    await expect(listProcessUsage({ platform })).resolves.toEqual([]);
  });

  it('accepts an injected execution port and timeout override', async () => {
    const run = vi.fn(async () => ({
      code: undefined, error: null, ok: true, stderr: '', stdout: '42 1 1 00:01 /bin/worker',
    }));
    await expect(listProcessUsage({ platform: 'linux', run }, { timeoutMs: 250 })).resolves.toEqual([
      { pid: 42, ppid: 1, rssBytes: 1024, cpuSeconds: 1, name: 'worker' },
    ]);
    expect(run).toHaveBeenCalledWith('ps', ['-axo', 'pid=,ppid=,rss=,time=,comm='], {
      encoding: 'utf8', timeout: 250, maxBuffer: 8 * 1024 * 1024, windowsHide: true,
    });
  });

  it('returns [] when the injected execution port rejects', async () => {
    const run = vi.fn(async () => { throw new Error('unavailable'); });
    await expect(listProcessUsage({ run })).resolves.toEqual([]);
  });

  it('defaults to the host platform when no ports are supplied', async () => {
    mockState.execFileImpl = (command, _args, _options, callback) => {
      if (process.platform === 'win32') expect(command).toMatch(POWERSHELL_PATH);
      else expect(command).toBe('ps');
      callback(null, '', '');
    };
    await expect(listProcessUsage()).resolves.toEqual([]);
  });
});

describe('@jini-ai/platform — process — sampleProcessPrivateMemory', () => {
  it.each([['12 B', 12], ['2 KB', 2048], ['1.5 MB', 1572864], ['1 GB', 1073741824]] as const)(
    'preserves the existing footprint parser units: %s', (reading, bytes) => {
      expect(parseProcessFootprint({ text: `Footprint: ${reading}` })).toBe(bytes);
    },
  );

  it.each(['unreadable', 'Footprint: ... MB'])('invalid footprint output stays null: %s', (text) => {
    expect(parseProcessFootprint({ text })).toBeNull();
  });

  it('Windows private working set joins on PID rather than instance name', async () => {
    const run = vi.fn(async () => ({ code: undefined, error: null, ok: true, stderr: '', stdout: JSON.stringify([
      { IDProcess: 102, Name: 'node', WorkingSetPrivate: '4096', WorkingSet: 999999, PrivateBytes: 888888 },
      { IDProcess: 101, Name: 'node#1', WorkingSetPrivate: '2048', WorkingSet: 999999, PrivateBytes: 888888 },
      { IDProcess: 0, Name: '_Total', WorkingSetPrivate: 777777 },
    ]) }));
    await expect(sampleProcessPrivateMemory({ pids: [101, 102, 101, 103], platform: 'win32', run }, { timeoutMs: 250 })).resolves.toEqual({
      metric: 'private-working-set', readings: [{ pid: 101, bytes: 2048 }, { pid: 102, bytes: 4096 }, { pid: 103, bytes: null }],
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(expect.stringMatching(POWERSHELL_PATH), ['-NoProfile', '-NonInteractive', '-Command',
      "$ErrorActionPreference = 'Stop'; Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Select-Object IDProcess, WorkingSetPrivate | ConvertTo-Json -Compress"], {
      encoding: 'utf8', timeout: 250, maxBuffer: 8 * 1024 * 1024, windowsHide: true,
    });
  });

  it('macOS samples footprint in one bounded top read and keeps unreadable results null', async () => {
    const run = vi.fn(async () => ({
      code: undefined, error: null, ok: true, stderr: '', stdout: 'PID MEM\n101 1.5M\n102 --\n',
    }));
    await expect(sampleProcessPrivateMemory({ pids: [101, 102, 101], platform: 'darwin', run })).resolves.toEqual({
      metric: 'physical-footprint', readings: [{ pid: 101, bytes: 1572864 }, { pid: 102, bytes: null }],
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('/usr/bin/top', ['-l', '1', '-R', '-F', '-stats', 'pid,mem', '-pid', '101', '-pid', '102'], {
      encoding: 'utf8', timeout: 5000, maxBuffer: 8 * 1024 * 1024, windowsHide: true,
    });
  });

  it('batches all requested macOS PIDs and parses binary units and change suffixes', async () => {
    const calls: unknown[] = [];
    const result = await sampleProcessPrivateMemory({ pids: [12, 13, 14, 15, 12], platform: 'darwin', run: async (command, args, options) => {
      calls.push({ command, args, timeout: options?.timeout, maxBuffer: options?.maxBuffer });
      return { ok: true, stdout: 'Processes: 99 total\nPID MEM\n13 1.5M+\n12 123K-\n14 2G\n15 0B\n99 999M\n', stderr: '', code: 0, error: null };
    } });
    expect(calls).toEqual([{ command: '/usr/bin/top', args: ['-l', '1', '-R', '-F', '-stats', 'pid,mem', '-pid', '12', '-pid', '13', '-pid', '14', '-pid', '15'], timeout: 5000, maxBuffer: 8 * 1024 * 1024 }]);
    expect(result).toEqual({ metric: 'physical-footprint', readings: [
      { pid: 12, bytes: 125952 }, { pid: 13, bytes: 1572864 }, { pid: 14, bytes: 2147483648 }, { pid: 15, bytes: 0 },
    ] });
  });

  it('top leaves missing, duplicate, malformed and unsafe readings unavailable per PID', async () => {
    const result = await sampleProcessPrivateMemory({ pids: [1, 2, 3, 4, 5, 6, 7], platform: 'darwin', run: async () => ({
      ok: true, stdout: 'PID MEM\n1 25M\n2 10M\n2 11M\n3 --\n4 -2G\n5 4Q\n6 999999999999999G\n', stderr: '', code: 0, error: null,
    }) });
    expect(result.readings).toEqual([{ pid: 1, bytes: 26214400 }, ...[2, 3, 4, 5, 6, 7].map(pid => ({ pid, bytes: null }))]);
  });

  it.each(['null', '{broken', '{}', '[{"IDProcess":101,"WorkingSetPrivate":null}]', '[{"IDProcess":101,"WorkingSetPrivate":-1}]'])('missing Windows counters stay unavailable: %s', async (stdout) => {
    const run = vi.fn(async () => ({ code: undefined, error: null, ok: true, stderr: '', stdout }));
    await expect(sampleProcessPrivateMemory({ pids: [101], platform: 'win32', run })).resolves.toEqual({
      metric: 'private-working-set', readings: [{ pid: 101, bytes: null }],
    });
  });

  it.each(['darwin', 'win32'] as const)('failed or rejected %s probes never use partial output', async (platform) => {
    const run = vi.fn(async () => ({ code: 1, error: new Error('timeout'), ok: false, stderr: '', stdout: 'PID MEM\n101 1M\n' }));
    const expected = { metric: platform === 'darwin' ? 'physical-footprint' : 'private-working-set', readings: [{ pid: 101, bytes: null }] };
    await expect(sampleProcessPrivateMemory({ pids: [101], platform, run })).resolves.toEqual(expected);
    run.mockImplementation(async () => { throw new Error('unavailable'); });
    await expect(sampleProcessPrivateMemory({ pids: [101], platform, run })).resolves.toEqual(expected);
  });

  it('unsupported hosts report unavailable without executing commands', async () => {
    const run = vi.fn();
    await expect(sampleProcessPrivateMemory({ pids: [101], platform: 'linux', run })).resolves.toEqual({
      metric: 'unavailable', readings: [{ pid: 101, bytes: null }],
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('rejects invalid PIDs and oversized samples before executing probes', async () => {
    const run = vi.fn();
    await expect(sampleProcessPrivateMemory({ pids: [0], run })).rejects.toThrow(/PID/);
    await expect(sampleProcessPrivateMemory({ pids: [1, 2], run }, { maxPids: 1 })).rejects.toThrow(/limit/);
    await expect(sampleProcessPrivateMemory({ pids: [], platform: 'darwin', run })).resolves.toEqual({ metric: 'physical-footprint', readings: [] });
    expect(run).not.toHaveBeenCalled();
  });
});


it('enumeration treats a malformed PowerShell response as unavailable even when the command exits successfully', async () => {
  const run = vi.fn(async () => ({ code: 0, error: null, ok: true, stderr: '', stdout: '[{"ProcessId":101,' }));
  await expect(listProcessSnapshots({ platform: 'win32', run }, { commandLines: false, timeoutMs: 400 })).resolves.toEqual([]);
  expect(run).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(POWERSHELL_PATH), [
    '-NoProfile', '-NonInteractive', '-Command',
    "$ErrorActionPreference = 'Stop'; Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name | ConvertTo-Json -Compress",
  ], { encoding: 'utf8', timeout: 400, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
});

it('does not interpret preamble text as footprint rows when top omits the PID/MEM header', async () => {
  const run = async () => ({ ok: true, stdout: 'Processes: 123 total\n81 17M\n34 2G\n', stderr: '', code: 0, error: null });
  const result = await sampleProcessPrivateMemory({ pids: [81, 34], platform: 'darwin', run });
  expect(result).toEqual({ metric: 'physical-footprint', readings: [{ pid: 81, bytes: null }, { pid: 34, bytes: null }] });
});

it('rejects invalid Windows sample limits before a probe and keeps a valid bounded PID sample', async () => {
  const run = vi.fn(async () => ({ code: 0, error: null, ok: true, stderr: '',
    stdout: '[{"IDProcess":0,"WorkingSetPrivate":23},{"IDProcess":"89","WorkingSetPrivate":"2048"}]' }));
  for (const maxPids of [0, -1, 0.5, Number.NaN]) {
    await expect(sampleProcessPrivateMemory({ pids: [], platform: 'win32', run }, { maxPids })).rejects.toThrow(new RangeError('process sample exceeds PID limit'));
  }
  expect(run.mock.calls).toEqual([]);
  await expect(sampleProcessPrivateMemory({ pids: [89], platform: 'win32', run }, { maxPids: 1 })).resolves.toEqual({
    metric: 'private-working-set', readings: [{ pid: 89, bytes: 2048 }],
  });
});
