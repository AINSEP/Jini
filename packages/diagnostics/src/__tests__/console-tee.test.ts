import { once } from 'node:events';
import { PassThrough } from 'node:stream';
import { inspect } from 'node:util';
import { afterEach, expect, it, vi } from 'vitest';
import { createRedactedOutputSink, installConsoleTee, type CaptureFailure, type ConsoleTeeBuffer, type TeeableConsole } from '../console-tee.js';
import { redactText } from '../redaction.js';

afterEach(() => vi.restoreAllMocks());

type Line = Parameters<ConsoleTeeBuffer['append']>[0];

function fakeConsole() {
  const calls: Array<[string, unknown[]]> = [];
  const target = Object.fromEntries((['debug', 'log', 'info', 'warn', 'error'] as const).map(m => [m, (...args: unknown[]) => { calls.push([m, args]); }])) as TeeableConsole;
  return { target, calls };
}

function fakeBuffer() {
  const lines: Line[] = [];
  const buffer: ConsoleTeeBuffer = { append: input => { lines.push(input); } };
  return { buffer, lines };
}

const redactSecrets = ({ text }: { text: string }) => redactText({ text });

it('hands the original console method the formatted string that is captured', () => {
  const { target, calls } = fakeConsole();
  const { buffer, lines } = fakeBuffer();
  installConsoleTee({ buffer }, { target });
  target.error('[route] failed', 42, new Error('boom'));
  expect(calls).toEqual([['error', [lines[0]!.message]]]);
  expect(lines[0]).toMatchObject({ level: 'error', source: 'server' });
  expect(lines[0]!.message).toMatch(/^\[route\] failed 42 Error: boom\n/);
});

it('maps console methods to levels (debug, log->info, info, warn, error) and tags the source', () => {
  const { target } = fakeConsole();
  const { buffer, lines } = fakeBuffer();
  installConsoleTee({ buffer }, { target, source: 'daemon' });
  target.debug('d'); target.log('l'); target.info('i'); target.warn('w'); target.error('e');
  expect(lines.map(l => [l.level, l.message, l.source])).toEqual([['debug', 'd', 'daemon'], ['info', 'l', 'daemon'], ['info', 'i', 'daemon'], ['warn', 'w', 'daemon'], ['error', 'e', 'daemon']]);
});

it('applies format placeholders like console does and redacts secrets before both copies', () => {
  const { target, calls } = fakeConsole();
  const { buffer, lines } = fakeBuffer();
  installConsoleTee({ buffer }, { target, redact: redactSecrets });
  const key = ['sk', '-', 'a'.repeat(40)].join('');
  target.warn('retrying %s with %d attempts, key %s', 'provider', 3, key);
  expect(lines[0]!.message).toBe('retrying provider with 3 attempts, key [REDACTED]');
  expect(calls).toEqual([['warn', [lines[0]!.message]]]);
});

it('formats once and runs the injected redactor once before either copy exists', () => {
  const { target, calls } = fakeConsole();
  const { buffer, lines } = fakeBuffer();
  let formats = 0;
  let redactions = 0;
  installConsoleTee({ buffer }, { target, redact: ({ text }) => {
    redactions += 1;
    expect(text).toBe('secret');
    expect(calls).toHaveLength(0);
    expect(lines).toHaveLength(0);
    return 'safe %s';
  } });
  target.log({ [inspect.custom]() { formats += 1; return 'secret'; } });
  expect([formats, redactions]).toEqual([1, 1]);
  expect(calls).toEqual([['log', ['safe %s']]]);
  expect(lines[0]!.message).toBe('safe %s');
});

it('defaults to identity redaction', () => {
  const { target, calls } = fakeConsole();
  const { buffer, lines } = fakeBuffer();
  installConsoleTee({ buffer }, { target });
  target.log('password=hunter2hunter2');
  expect(calls).toEqual([['log', ['password=hunter2hunter2']]]);
  expect(lines[0]!.message).toBe('password=hunter2hunter2');
});

it('emits only the fixed placeholder when the redactor throws, and never throws', () => {
  const { target, calls } = fakeConsole();
  const { buffer, lines } = fakeBuffer();
  installConsoleTee({ buffer }, { target, redact: () => { throw new Error('secret in redactor failure'); } });
  expect(() => target.error('secret in raw arguments')).not.toThrow();
  expect(calls).toEqual([['error', ['[log redaction failed]']]]);
  expect(lines[0]!.message).toBe('[log redaction failed]');
});

it('emits only the fixed placeholder when formatting throws, and never throws', () => {
  const { target, calls } = fakeConsole();
  const { buffer, lines } = fakeBuffer();
  installConsoleTee({ buffer }, { target });
  expect(() => target.error({ [inspect.custom]() { throw new Error('secret'); } })).not.toThrow();
  expect(calls).toEqual([['error', ['[log redaction failed]']]]);
  expect(lines[0]!.message).toBe('[log redaction failed]');
});

it('patches the global console when no target is given, and puts it back on uninstall', () => {
  const printed = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const { buffer, lines } = fakeBuffer();
  const uninstall = installConsoleTee({ buffer });
  console.log('to the global console');
  uninstall();
  console.log('after uninstall');
  expect(printed.mock.calls).toEqual([['to the global console'], ['after uninstall']]);
  expect(lines.map(l => l.message)).toEqual(['to the global console']);
});

it('restores exactly the original methods on uninstall', () => {
  const { target, calls } = fakeConsole();
  const originals = { ...target };
  const { buffer, lines } = fakeBuffer();
  const uninstall = installConsoleTee({ buffer }, { target, redact: () => 'redacted' });
  uninstall();
  expect(target).toEqual(originals);
  target.error('after');
  expect(lines).toHaveLength(0);
  expect(calls).toEqual([['error', ['after']]]);
});

it('keeps the original console call when the buffer is full and throws (a captured copy may be lost, the output may not)', () => {
  const { target, calls } = fakeConsole();
  const full: ConsoleTeeBuffer = { append: () => { throw new Error('buffer full'); } };
  installConsoleTee({ buffer: full }, { target });
  expect(() => target.error('still printed')).not.toThrow();
  expect(calls).toEqual([['error', ['still printed']]]);
});

it('keeps logging after a full buffer: the next call reaches both copies once the buffer recovers', () => {
  const { target, calls } = fakeConsole();
  const lines: Line[] = [];
  let full = true;
  installConsoleTee({ buffer: { append: input => { if (full) throw new Error('buffer full'); lines.push(input); } } }, { target });
  target.log('lost copy');
  full = false;
  target.log('kept copy');
  expect(calls.map(([, args]) => args[0])).toEqual(['lost copy', 'kept copy']);
  expect(lines.map(l => l.message)).toEqual(['kept copy']);
});

async function pump(run: (write: (chunk: string | Buffer) => void) => void, options: Parameters<typeof createRedactedOutputSink>[1] = {}, redact: (r: { text: string }) => string = redactSecrets) {
  const output: string[] = [];
  const stream = createRedactedOutputSink({ sink: { write: text => { output.push(String(text)); return true; } }, redact }, options);
  run(chunk => stream.write(chunk));
  stream.end();
  await once(stream, 'finish');
  return output;
}

it('frames child output across split credentials and UTF-8, flushes the last line, and never ends the parent', async () => {
  const secret = ['ghp', '_', 'x'.repeat(36)].join('');
  const sink = new PassThrough();
  let output = '';
  sink.on('data', bytes => { output += bytes.toString(); });
  const stream = createRedactedOutputSink({ sink, redact: ({ text }) => redactText({ text }, { username: 'diagnostic-user' }) });
  stream.write(Buffer.from('native fatal: café ').subarray(0, 18));
  stream.write(Buffer.from('native fatal: café ').subarray(18));
  stream.write(secret.slice(0, 5));
  stream.write(secret.slice(5) + ' /Users/diagnostic-user/private/addon.node');
  stream.end();
  await once(stream, 'finish');
  expect(output).toBe('native fatal: café [REDACTED] /Users/<USER>/private/addon.node\n');
  expect(sink.writableEnded).toBe(false);
});

it('drops an oversized line whole (no prefix leaks) and still delivers the next line', async () => {
  const secret = ['sk', '-', 'a'.repeat(100_000)].join('');
  const output = await pump(write => { write('first safe line\n' + secret.slice(0, 50_000)); write(secret.slice(50_000) + '\nnext safe line\n'); }, { maxLength: 100 });
  expect(output).toEqual(['first safe line\n', '[oversized output line omitted]\n', 'next safe line\n']);
  expect(output.join('')).not.toContain(secret.slice(0, 30));
  expect(output.join('')).not.toContain(secret.slice(-30));
});

it('bounds a long safe line to maxLength characters plus the newline', async () => {
  const output = await pump(write => write('safe '.repeat(100)), { maxLength: 100 });
  expect(output[0]).toHaveLength(101);
});

it('fails closed with a fixed placeholder when the redactor throws, never the raw text', async () => {
  const output = await pump(write => write('private raw text'), {}, () => { throw new Error('redactor unavailable'); });
  expect(output).toEqual(['[output redaction failed]\n']);
});

it('accepts the exact line limit across chunks and preserves empty lines', async () => {
  const redacted: string[] = [];
  const output = await pump(write => { write(Buffer.alloc(0)); write('ab'); write('cd\n\nx\ny'); }, { maxLineLength: 4 }, ({ text }) => { redacted.push(text); return `<${text}>`; });
  expect(redacted).toEqual(['abcd', '', 'x', 'y']);
  expect(output).toEqual(['<abcd>\n', '<>\n', '<x>\n', '<y>\n']);
});

it('discards an oversized continuation until the newline and at the final flush', async () => {
  const redacted: string[] = [];
  const output = await pump(write => {
    write('abcd'); write('e'); write('ignored'); write(' remainder\nok\nabcde\nend'); write('ing');
  }, { maxLineLength: 4 }, ({ text }) => { redacted.push(text); return text; });
  expect(redacted).toEqual(['ok']);
  expect(output).toEqual(['[oversized output line omitted]\n', 'ok\n', '[oversized output line omitted]\n', '[oversized output line omitted]\n']);
});

it('flushes the unterminated last line when its source unpipes without ending the sink', async () => {
  const output: string[] = [];
  const stream = createRedactedOutputSink({ sink: { write: text => { output.push(String(text)); return true; } }, redact: ({ text }) => text });
  const source = new PassThrough();
  source.pipe(stream, { end: false });
  source.end('fatal without newline');
  await once(stream, 'unpipe');
  expect(output).toEqual(['fatal without newline\n']);
});

it('retains each emitted (redacted, bounded) line on the shared tail before mirroring it', async () => {
  const secret = ['ghp', '_', 'x'.repeat(36)].join('');
  const retain = { outputTail: '' };
  const output = await pump(write => write(`boot ${secret}\n` + 'y'.repeat(50)), { retain, maxLength: 20 });
  expect(retain.outputTail).toBe(output.join(''));
  expect(retain.outputTail).not.toContain(secret);
  expect(output).toEqual(['boot [REDACTED]\n', `${'y'.repeat(20)}\n`]);
});

it('trims the shared tail to the latest tailKeepChars only once it grows past twice that', async () => {
  const retain = { outputTail: '' };
  const tails: string[] = [];
  await pump(write => {
    for (const line of ['aa\n', 'bb\n', 'cc\n', 'dd\n']) { write(line); tails.push(retain.outputTail); }
  }, { retain, tailKeepChars: 4 }, ({ text }) => text);
  expect(tails).toEqual(['aa\n', 'aa\nbb\n', '\ncc\n', '\ncc\ndd\n']);
});

it('interleaves every sink that shares one retained tail, in emission order', async () => {
  const retain = { outputTail: '' };
  const sinks = ['out', 'err'].map(() => createRedactedOutputSink({ sink: { write: () => true }, redact: ({ text }) => text }, { retain }));
  sinks[0]!.write('one\n'); sinks[1]!.write('two\n'); sinks[0]!.write('three\n');
  expect(retain.outputTail).toBe('one\ntwo\nthree\n');
});

it('writes nothing for an empty redaction result', async () => {
  const output = await pump(write => write('hidden\n'), {}, () => '');
  expect(output).toEqual([]);
});

it('reports each failed capture step by stage, with the original error, without interrupting the console call', async () => {
  const { target, calls } = fakeConsole();
  const failures: CaptureFailure[] = [];
  const onFailure = (failure: CaptureFailure) => { failures.push(failure); };
  const buffer: ConsoleTeeBuffer = { append: () => { throw new Error('buffer full'); } };
  installConsoleTee({ buffer }, { target, onFailure, redact: ({ text }) => { if (text === 'bad') throw new Error('redactor'); return text; } });
  target.log('bad');
  target.log('good');
  expect(calls.map(([, args]) => args[0])).toEqual(['[log redaction failed]', 'good']);
  expect(failures.map(f => [f.stage, (f.error as Error).message])).toEqual([['format', 'redactor'], ['append', 'buffer full'], ['append', 'buffer full']]);
  const sinkFailures: CaptureFailure[] = [];
  const stream = createRedactedOutputSink({ sink: { write: () => true }, redact: () => { throw new Error('sink redactor'); } }, { onFailure: f => { sinkFailures.push(f); } });
  stream.end('raw\n');
  await once(stream, 'finish');
  expect(sinkFailures.map(f => [f.stage, (f.error as Error).message])).toEqual([['redact', 'sink redactor']]);
});
