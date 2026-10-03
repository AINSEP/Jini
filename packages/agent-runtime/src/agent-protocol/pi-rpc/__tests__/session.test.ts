import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  attachPiRpcSession,
  replyExtensionUi,
  readPiSessionFiles,
  snapshotPiSessionFiles,
  resolveSessionPathChangedSince,
} from '../session.js';

class FakeStdin extends EventEmitter {
  writes: string[] = [];
  ended = false;
  destroyed = false;
  failWriteWith: Error | null = null;
  write(chunk: string) {
    if (this.failWriteWith) throw this.failWriteWith;
    this.writes.push(chunk);
    return true;
  }
  end() {
    if (this.failEndWith) throw this.failEndWith;
    this.ended = true;
  }
  failEndWith: Error | null = null;
}

class FakeStdout extends EventEmitter {}

class FakeChild extends EventEmitter {
  stdin: FakeStdin | null = new FakeStdin();
  stdout: FakeStdout | null = new FakeStdout();
  killed = false;
  kill(_signal?: string) {
    this.killed = true;
    return true;
  }
}

function lastWrite(child: FakeChild) {
  const raw = child.stdin!.writes.at(-1);
  return raw ? JSON.parse(raw) : null;
}

function emitLine(child: FakeChild, obj: unknown) {
  child.stdout!.emit('data', `${JSON.stringify(obj)}\n`);
}

describe('replyExtensionUi', () => {
  function fakeWritable() {
    const writes: string[] = [];
    return { write: (c: string) => { writes.push(c); return true; }, writes } as unknown as import('node:stream').Writable & { writes: string[] };
  }

  it('does nothing when raw.id is null/undefined', () => {
    const w = fakeWritable();
    replyExtensionUi(w, { id: null });
    replyExtensionUi(w, {});
    expect((w as any).writes).toEqual([]);
  });

  it('silently consumes fire-and-forget methods', () => {
    const w = fakeWritable();
    replyExtensionUi(w, { id: 1, method: 'setStatus' });
    expect((w as any).writes).toEqual([]);
  });

  it('auto-resolves confirm to { confirmed: true }', () => {
    const w = fakeWritable();
    replyExtensionUi(w, { id: 1, method: 'confirm' });
    const written = JSON.parse((w as any).writes[0]);
    expect(written).toEqual({ type: 'extension_ui_response', id: 1, confirmed: true });
  });

  it('picks the first string option for a select-style request', () => {
    const w = fakeWritable();
    replyExtensionUi(w, { id: 2, method: 'select', params: { options: ['a', 'b'] } });
    const written = JSON.parse((w as any).writes[0]);
    expect(written).toEqual({ type: 'extension_ui_response', id: 2, value: 'a' });
  });

  it('picks the first object option, preferring label over value', () => {
    const w = fakeWritable();
    replyExtensionUi(w, { id: 3, method: 'select', options: [{ label: 'Label A', value: 'a' }] });
    const written = JSON.parse((w as any).writes[0]);
    expect(written).toEqual({ type: 'extension_ui_response', id: 3, value: 'Label A' });
  });

  it('falls back to value when an object option has no label', () => {
    const w = fakeWritable();
    replyExtensionUi(w, { id: 4, method: 'select', options: [{ value: 'v' }] });
    const written = JSON.parse((w as any).writes[0]);
    expect(written).toEqual({ type: 'extension_ui_response', id: 4, value: 'v' });
  });

  it('falls back to "" when an object option has neither label nor value', () => {
    const w = fakeWritable();
    replyExtensionUi(w, { id: 5, method: 'select', options: [{}] });
    const written = JSON.parse((w as any).writes[0]);
    expect(written).toEqual({ type: 'extension_ui_response', id: 5, value: '' });
  });

  it('responds with cancelled: true when no options are present', () => {
    const w = fakeWritable();
    replyExtensionUi(w, { id: 6, method: 'input' });
    const written = JSON.parse((w as any).writes[0]);
    expect(written).toEqual({ type: 'extension_ui_response', id: 6, cancelled: true });
  });

  it('responds with cancelled: true when options is present but empty', () => {
    const w = fakeWritable();
    replyExtensionUi(w, { id: 7, method: 'input', options: [] });
    const written = JSON.parse((w as any).writes[0]);
    expect(written).toEqual({ type: 'extension_ui_response', id: 7, cancelled: true });
  });
});

describe('readPiSessionFiles / snapshotPiSessionFiles / resolveSessionPathChangedSince', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-rpc-test-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns [] when cwd is undefined or empty', () => {
    expect(readPiSessionFiles(undefined)).toEqual([]);
    expect(readPiSessionFiles('')).toEqual([]);
  });

  it('returns [] when the sessions directory does not exist', () => {
    expect(readPiSessionFiles(dir)).toEqual([]);
  });

  it('lists only .jsonl files, ignoring other extensions and subdirectories', () => {
    const sessionsDir = path.join(dir, '.pi', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(path.join(sessionsDir, 'a.jsonl'), '{}');
    fs.writeFileSync(path.join(sessionsDir, 'b.txt'), 'nope');
    fs.mkdirSync(path.join(sessionsDir, 'subdir'));
    const files = readPiSessionFiles(dir);
    expect(files.map((f) => path.basename(f.path))).toEqual(['a.jsonl']);
  });

  it('snapshot + resolveSessionPathChangedSince detects the single changed file', () => {
    const sessionsDir = path.join(dir, '.pi', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(path.join(sessionsDir, 'a.jsonl'), '{}');
    const before = snapshotPiSessionFiles(dir);
    // Ensure a detectable mtime/size change.
    fs.writeFileSync(path.join(sessionsDir, 'a.jsonl'), '{"more":"data"}');
    const changed = resolveSessionPathChangedSince(dir, before);
    expect(changed).toBe(path.join(sessionsDir, 'a.jsonl'));
  });

  it('returns null when zero files changed', () => {
    const sessionsDir = path.join(dir, '.pi', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(path.join(sessionsDir, 'a.jsonl'), '{}');
    const before = snapshotPiSessionFiles(dir);
    expect(resolveSessionPathChangedSince(dir, before)).toBeNull();
  });

  it('returns null when more than one file changed', () => {
    const sessionsDir = path.join(dir, '.pi', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(path.join(sessionsDir, 'a.jsonl'), '{}');
    fs.writeFileSync(path.join(sessionsDir, 'b.jsonl'), '{}');
    const before = snapshotPiSessionFiles(dir);
    fs.writeFileSync(path.join(sessionsDir, 'a.jsonl'), '{"x":1}');
    fs.writeFileSync(path.join(sessionsDir, 'b.jsonl'), '{"y":1}');
    expect(resolveSessionPathChangedSince(dir, before)).toBeNull();
  });

  it('detects a brand-new file not present in the before-snapshot', () => {
    const sessionsDir = path.join(dir, '.pi', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    const before = snapshotPiSessionFiles(dir);
    fs.writeFileSync(path.join(sessionsDir, 'new.jsonl'), '{}');
    expect(resolveSessionPathChangedSince(dir, before)).toBe(path.join(sessionsDir, 'new.jsonl'));
  });

  it('skips an unreadable entry rather than throwing', () => {
    const sessionsDir = path.join(dir, '.pi', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(path.join(sessionsDir, 'a.jsonl'), '{}');
    const statSpy = vi.spyOn(fs, 'statSync').mockImplementation(() => {
      throw new Error('boom');
    });
    expect(readPiSessionFiles(dir)).toEqual([]);
    statSpy.mockRestore();
  });
});

describe('attachPiRpcSession', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-rpc-attach-test-'));
    vi.useFakeTimers();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    vi.useRealTimers();
  });

  it('throws when stdin is missing', () => {
    const child = new FakeChild();
    child.stdin = null;
    expect(() =>
      attachPiRpcSession({ child: child as any, prompt: 'hi', send: vi.fn() }),
    ).toThrow('pi RPC child process is missing stdin');
  });

  it('throws when stdout is missing', () => {
    const child = new FakeChild();
    child.stdout = null;
    expect(() =>
      attachPiRpcSession({ child: child as any, prompt: 'hi', send: vi.fn() }),
    ).toThrow('pi RPC child process is missing stdout');
  });

  it('sends an initializing status immediately with the model name', () => {
    const child = new FakeChild();
    const send = vi.fn();
    attachPiRpcSession({ child: child as any, prompt: 'hi', send }, { model: 'gpt-4' });
    expect(send).toHaveBeenCalledWith({ event: 'agent', payload: { type: 'status', label: 'initializing', model: 'gpt-4' } });
  });

  it('sends null model when model is not a non-empty string', () => {
    const child = new FakeChild();
    const send = vi.fn();
    attachPiRpcSession({ child: child as any, prompt: 'hi', send }, { model: '' });
    expect(send).toHaveBeenCalledWith({ event: 'agent', payload: expect.objectContaining({ model: null }) });
  });

  it('sends the prompt immediately when there is no parentSession', () => {
    const child = new FakeChild();
    attachPiRpcSession({ child: child as any, prompt: 'hello world', send: vi.fn() });
    expect(lastWrite(child)).toEqual({ id: 1, type: 'prompt', message: 'hello world' });
  });

  it('drives a full happy-path prompt/response cycle to agent_end, then SIGTERMs after the grace period', () => {
    const child = new FakeChild();
    const send = vi.fn();
    const session = attachPiRpcSession({ child: child as any, prompt: 'hi', send });

    emitLine(child, { type: 'agent_start' });
    emitLine(child, { type: 'turn_start' });
    emitLine(child, {
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'Hello!' },
    });
    emitLine(child, { type: 'agent_end' });

    expect(session.hasFatalError()).toBe(false);
    expect(child.stdin!.ended).toBe(true);
    expect(child.killed).toBe(false);

    vi.advanceTimersByTime(5000);
    expect(child.killed).toBe(true);
  });

  it('captures the changed session file path on agent_end', () => {
    const sessionsDir = path.join(dir, '.pi', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(path.join(sessionsDir, 'existing.jsonl'), '{}');
    const child = new FakeChild();
    const session = attachPiRpcSession({ child: child as any, prompt: 'hi', send: vi.fn() }, { cwd: dir });
    // Simulate pi having written the session file during the run.
    fs.writeFileSync(path.join(sessionsDir, 'existing.jsonl'), '{"more":true}');
    emitLine(child, { type: 'agent_end' });
    expect(session.getLastSessionPath()).toBe(path.join(sessionsDir, 'existing.jsonl'));
  });

  it('returns null from getLastSessionPath before agent_end fires', () => {
    const child = new FakeChild();
    const session = attachPiRpcSession({ child: child as any, prompt: 'hi', send: vi.fn() });
    expect(session.getLastSessionPath()).toBeNull();
  });

  it('respects PI_GRACEFUL_SHUTDOWN_MS for the post-agent_end SIGTERM delay', () => {
    const original = process.env.PI_GRACEFUL_SHUTDOWN_MS;
    process.env.PI_GRACEFUL_SHUTDOWN_MS = '100';
    try {
      const child = new FakeChild();
      attachPiRpcSession({ child: child as any, prompt: 'hi', send: vi.fn() });
      emitLine(child, { type: 'agent_end' });
      vi.advanceTimersByTime(99);
      expect(child.killed).toBe(false);
      vi.advanceTimersByTime(2);
      expect(child.killed).toBe(true);
    } finally {
      if (original === undefined) delete process.env.PI_GRACEFUL_SHUTDOWN_MS;
      else process.env.PI_GRACEFUL_SHUTDOWN_MS = original;
    }
  });

  it('does not SIGTERM again on the grace timer if the child was already killed', () => {
    const child = new FakeChild();
    attachPiRpcSession({ child: child as any, prompt: 'hi', send: vi.fn() });
    emitLine(child, { type: 'agent_end' });
    child.killed = true;
    expect(() => vi.advanceTimersByTime(5000)).not.toThrow();
  });

  it('swallows a stdin.end() failure on agent_end without throwing (finished is already true, so fail() no-ops)', () => {
    // `finished` is set to `true` immediately on agent_end, before the
    // stdin.end() try/catch runs — so fail()'s own `if (finished) return;`
    // guard means the catch block can never actually mark the session
    // fatal or emit an 'error' event here. It still matters: catching the
    // throw here (rather than letting it propagate) stops it from being
    // absorbed instead by createJsonLineStream's own emit() try/catch,
    // which would otherwise perturb the line-stream's internal pending-json
    // state. See archived provenance ledger.
    const child = new FakeChild();
    const send = vi.fn();
    child.stdin!.failEndWith = new Error('already closed');
    const session = attachPiRpcSession({ child: child as any, prompt: 'hi', send });
    expect(() => emitLine(child, { type: 'agent_end' })).not.toThrow();
    expect(session.hasFatalError()).toBe(false);
    expect(send).not.toHaveBeenCalledWith({ event: 'error', payload: expect.anything() });
  });

  it('ignores non-record parsed lines', () => {
    const child = new FakeChild();
    const session = attachPiRpcSession({ child: child as any, prompt: 'hi', send: vi.fn() });
    child.stdout!.emit('data', `${JSON.stringify('just a string')}\n`);
    expect(session.hasFatalError()).toBe(false);
  });

  it('stops acting on further parsed objects once finished, but keeps draining the stream', () => {
    const child = new FakeChild();
    const send = vi.fn();
    attachPiRpcSession({ child: child as any, prompt: 'hi', send });
    emitLine(child, { type: 'agent_end' });
    send.mockClear();
    // Further data after finished must be a no-op (no further sends), and
    // must not throw.
    expect(() => emitLine(child, { type: 'agent_start' })).not.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  it('auto-resolves an extension_ui_request via replyExtensionUi', () => {
    const child = new FakeChild();
    attachPiRpcSession({ child: child as any, prompt: 'hi', send: vi.fn() });
    emitLine(child, { type: 'extension_ui_request', id: 42, method: 'confirm' });
    const written = lastWrite(child);
    expect(written).toEqual({ type: 'extension_ui_response', id: 42, confirmed: true });
  });

  describe('parentSession resume flow', () => {
    it('sends new_session first and withholds the prompt until acknowledged', () => {
      const child = new FakeChild();
      attachPiRpcSession({ child: child as any, prompt: 'follow up', send: vi.fn() }, { parentSession: '/tmp/prior.jsonl' });
      expect(lastWrite(child)).toEqual({ id: 1, type: 'new_session', parentSession: '/tmp/prior.jsonl' });
    });

    it('sends the prompt once the parent session response succeeds', () => {
      const child = new FakeChild();
      attachPiRpcSession({ child: child as any, prompt: 'follow up', send: vi.fn() }, { parentSession: '/tmp/prior.jsonl' });
      emitLine(child, { type: 'response', id: 1, success: true });
      expect(lastWrite(child)).toEqual({ id: 2, type: 'prompt', message: 'follow up' });
    });

    it('fails the run when the parent session response reports failure', () => {
      const child = new FakeChild();
      const send = vi.fn();
      const session = attachPiRpcSession({ child: child as any, prompt: 'follow up', send }, { parentSession: '/tmp/prior.jsonl' });
      emitLine(child, { type: 'response', id: 1, success: false, error: 'gone' });
      expect(session.hasFatalError()).toBe(true);
      expect(send).toHaveBeenCalledWith({ event: 'error', payload: { message: 'parent session rejected: gone', code: 'PI_PARENT_SESSION_FAILED' } });
    });

    it('uses "unknown" when the failed parent-session response has no error field', () => {
      const child = new FakeChild();
      const send = vi.fn();
      attachPiRpcSession({ child: child as any, prompt: 'x', send }, { parentSession: '/tmp/prior.jsonl' });
      emitLine(child, { type: 'response', id: 1, success: false });
      expect(send).toHaveBeenCalledWith({ event: 'error', payload: expect.objectContaining({ message: 'parent session rejected: unknown' }) });
    });
  });

  it('fails the run when the prompt response reports failure', () => {
    const child = new FakeChild();
    const send = vi.fn();
    const session = attachPiRpcSession({ child: child as any, prompt: 'hi', send });
    emitLine(child, { type: 'response', id: 1, success: false, error: 'rejected!' });
    expect(session.hasFatalError()).toBe(true);
    expect(send).toHaveBeenCalledWith({ event: 'error', payload: { message: 'prompt rejected: rejected!' } });
  });

  it('uses "unknown" when the failed prompt response has no error field', () => {
    const child = new FakeChild();
    const send = vi.fn();
    attachPiRpcSession({ child: child as any, prompt: 'hi', send });
    emitLine(child, { type: 'response', id: 1, success: false });
    expect(send).toHaveBeenCalledWith({ event: 'error', payload: { message: 'prompt rejected: unknown' } });
  });

  it('ignores a successful prompt-accepted response (no fatal error, no further action)', () => {
    const child = new FakeChild();
    const session = attachPiRpcSession({ child: child as any, prompt: 'hi', send: vi.fn() });
    emitLine(child, { type: 'response', id: 1, success: true });
    expect(session.hasFatalError()).toBe(false);
  });

  it('ignores a response frame with an id that matches neither parentSessionRpcId nor promptRpcId', () => {
    const child = new FakeChild();
    const session = attachPiRpcSession({ child: child as any, prompt: 'hi', send: vi.fn() });
    emitLine(child, { type: 'response', id: 999, success: false });
    expect(session.hasFatalError()).toBe(false);
  });

  describe('abort', () => {
    it('sends an abort RPC command', () => {
      const child = new FakeChild();
      const session = attachPiRpcSession({ child: child as any, prompt: 'hi', send: vi.fn() });
      session.abort();
      expect(lastWrite(child)).toEqual({ id: 2, type: 'abort' });
    });

    it('is idempotent once already finished', () => {
      const child = new FakeChild();
      const session = attachPiRpcSession({ child: child as any, prompt: 'hi', send: vi.fn() });
      emitLine(child, { type: 'agent_end' });
      const writesBefore = child.stdin!.writes.length;
      session.abort();
      expect(child.stdin!.writes.length).toBe(writesBefore);
    });

    it('is a no-op when the child is already killed', () => {
      const child = new FakeChild();
      const session = attachPiRpcSession({ child: child as any, prompt: 'hi', send: vi.fn() });
      child.killed = true;
      const writesBefore = child.stdin!.writes.length;
      session.abort();
      expect(child.stdin!.writes.length).toBe(writesBefore);
    });
  });

  describe('stdin error handling', () => {
    it('ignores an EPIPE stdin error', () => {
      const child = new FakeChild();
      const send = vi.fn();
      const session = attachPiRpcSession({ child: child as any, prompt: 'hi', send });
      const err: any = new Error('broken pipe');
      err.code = 'EPIPE';
      child.stdin!.emit('error', err);
      expect(session.hasFatalError()).toBe(false);
    });

    it('fails the run on a non-EPIPE stdin error', () => {
      const child = new FakeChild();
      const send = vi.fn();
      const session = attachPiRpcSession({ child: child as any, prompt: 'hi', send });
      child.stdin!.emit('error', new Error('disk full'));
      expect(session.hasFatalError()).toBe(true);
      expect(send).toHaveBeenCalledWith({ event: 'error', payload: { message: 'stdin: disk full' } });
    });

    it('marks stdin closed via the close event, preventing further sendCommand writes', () => {
      const child = new FakeChild();
      const session = attachPiRpcSession({ child: child as any, prompt: 'hi', send: vi.fn() });
      child.stdin!.emit('close');
      const writesBefore = child.stdin!.writes.length;
      session.abort();
      expect(child.stdin!.writes.length).toBe(writesBefore);
    });
  });

  it('fails the run when the child process itself errors', () => {
    const child = new FakeChild();
    const send = vi.fn();
    const session = attachPiRpcSession({ child: child as any, prompt: 'hi', send });
    child.emit('error', new Error('spawn failure'));
    expect(session.hasFatalError()).toBe(true);
    expect(send).toHaveBeenCalledWith({ event: 'error', payload: { message: 'spawn failure' } });
  });

  it('flushes the parser on stdout close', () => {
    const child = new FakeChild();
    const session = attachPiRpcSession({ child: child as any, prompt: 'hi', send: vi.fn() });
    // A complete line with no trailing newline stays buffered until flush.
    child.stdout!.emit('data', JSON.stringify({ type: 'agent_end' }));
    expect(session.getLastSessionPath()).toBeNull();
    child.stdout!.emit('close');
    expect(session.hasFatalError()).toBe(false);
  });

  it('fails the run when parser.feed()/toString() throws on a malformed chunk', () => {
    const child = new FakeChild();
    const send = vi.fn();
    const session = attachPiRpcSession({ child: child as any, prompt: 'hi', send });
    const hostileChunk = {
      toString() {
        throw new Error('cannot decode');
      },
    };
    child.stdout!.emit('data', hostileChunk as any);
    expect(session.hasFatalError()).toBe(true);
    expect(send).toHaveBeenCalledWith({ event: 'error', payload: { message: 'parser: cannot decode' } });
  });

  describe('image forwarding', () => {
    function writeImage(name: string, bytes = 10) {
      const p = path.join(dir, name);
      fs.writeFileSync(p, Buffer.alloc(bytes, 1));
      return p;
    }

    it('forwards a valid image under uploadRoot as base64', () => {
      const imgPath = writeImage('a.png');
      const child = new FakeChild();
      attachPiRpcSession({ child: child as any, prompt: 'hi', send: vi.fn() }, { imagePaths: [imgPath], uploadRoot: dir });
      const written = lastWrite(child);
      expect(written.images).toHaveLength(1);
      expect(written.images[0].mimeType).toBe('image/png');
      expect(written.images[0].type).toBe('image');
      expect(typeof written.images[0].data).toBe('string');
    });

    it('maps each allowed extension to the expected mime type', () => {
      const cases: Array<[string, string]> = [
        ['b.gif', 'image/gif'],
        ['c.webp', 'image/webp'],
        ['d.jpg', 'image/jpeg'],
        ['e.jpeg', 'image/jpeg'],
      ];
      for (const [name, mime] of cases) {
        const imgPath = writeImage(name);
        const child = new FakeChild();
        attachPiRpcSession({ child: child as any, prompt: 'hi', send: vi.fn() }, { imagePaths: [imgPath] });
        expect(lastWrite(child).images[0].mimeType).toBe(mime);
      }
    });

    it('sends no images field when imagePaths is empty or absent', () => {
      const child = new FakeChild();
      attachPiRpcSession({ child: child as any, prompt: 'hi', send: vi.fn() });
      expect(lastWrite(child).images).toBeUndefined();
      const child2 = new FakeChild();
      attachPiRpcSession({ child: child2 as any, prompt: 'hi', send: vi.fn() }, { imagePaths: [] });
      expect(lastWrite(child2).images).toBeUndefined();
    });

    it('skips a non-string or empty image path entry', () => {
      const child = new FakeChild();
      attachPiRpcSession({ child: child as any, prompt: 'hi', send: vi.fn() }, { imagePaths: ['', 42 as any] });
      expect(lastWrite(child).images).toBeUndefined();
    });

    it('skips an image with a disallowed extension', () => {
      const imgPath = writeImage('f.txt');
      const child = new FakeChild();
      attachPiRpcSession({ child: child as any, prompt: 'hi', send: vi.fn() }, { imagePaths: [imgPath] });
      expect(lastWrite(child).images).toBeUndefined();
    });

    it('skips a path that does not resolve to a regular file', () => {
      const subdir = path.join(dir, 'sub.png');
      fs.mkdirSync(subdir);
      const child = new FakeChild();
      attachPiRpcSession({ child: child as any, prompt: 'hi', send: vi.fn() }, { imagePaths: [subdir] });
      expect(lastWrite(child).images).toBeUndefined();
    });

    it('skips a nonexistent path (realpathSync throws) rather than failing the run', () => {
      const child = new FakeChild();
      attachPiRpcSession({ child: child as any, prompt: 'hi', send: vi.fn() }, { imagePaths: [path.join(dir, 'does-not-exist.png')] });
      expect(lastWrite(child).images).toBeUndefined();
    });

    it('skips an image whose resolved path escapes uploadRoot', () => {
      const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-rpc-outside-'));
      try {
        const imgPath = writeImage.call(null, 'g.png'); // inside dir, but uploadRoot will be outsideDir
        const child = new FakeChild();
        attachPiRpcSession({ child: child as any, prompt: 'hi', send: vi.fn() }, { imagePaths: [imgPath], uploadRoot: outsideDir });
        expect(lastWrite(child).images).toBeUndefined();
      } finally {
        fs.rmSync(outsideDir, { recursive: true, force: true });
      }
    });

    it('accepts an image path exactly equal to the resolved uploadRoot boundary check (root file itself)', () => {
      // uploadRoot pointing directly at the image's own realpath (edge of the
      // `realPath !== resolvedRoot` check) is an unusual but valid input —
      // the image itself, not a directory. Use the image's own path as an
      // (atypical) "root" to exercise the `realPath === resolvedRoot` branch.
      const imgPath = writeImage('h.png');
      const child = new FakeChild();
      attachPiRpcSession({ child: child as any, prompt: 'hi', send: vi.fn() }, { imagePaths: [imgPath], uploadRoot: imgPath });
      expect(lastWrite(child).images).toHaveLength(1);
    });

    it('stops forwarding once MAX_IMAGE_COUNT is reached', () => {
      const paths = Array.from({ length: 12 }, (_, i) => writeImage(`img${i}.png`));
      const child = new FakeChild();
      attachPiRpcSession({ child: child as any, prompt: 'hi', send: vi.fn() }, { imagePaths: paths });
      expect(lastWrite(child).images).toHaveLength(10);
    });

    it('stops forwarding once the total byte budget would be exceeded', () => {
      const big1 = writeImage('big1.png', 15 * 1024 * 1024);
      const big2 = writeImage('big2.png', 15 * 1024 * 1024);
      const child = new FakeChild();
      attachPiRpcSession({ child: child as any, prompt: 'hi', send: vi.fn() }, { imagePaths: [big1, big2] });
      expect(lastWrite(child).images).toHaveLength(1);
    });

    it('skips an image that throws during read (caught, run continues)', () => {
      const imgPath = writeImage('i.png');
      const readSpy = vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
        throw new Error('EACCES');
      });
      const child = new FakeChild();
      attachPiRpcSession({ child: child as any, prompt: 'hi', send: vi.fn() }, { imagePaths: [imgPath] });
      expect(lastWrite(child).images).toBeUndefined();
      readSpy.mockRestore();
    });
  });
});
