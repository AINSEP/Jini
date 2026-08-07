/**
 * Direct unit tests for the exported free-standing helpers in session.ts:
 * `firstDialogOptionResult`, `piImageMimeType`, `tryReadImagePayload`,
 * `buildPiImagePayloads`, and `handlePiResponseMessage`. The end-to-end
 * behavior through `attachPiRpcSession` is already covered by
 * `session.test.ts`; this file calls the exported units directly so each
 * branch is verifiable in isolation.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  firstDialogOptionResult,
  isPathUnderRoot,
  piImageMimeType,
  tryReadImagePayload,
  buildPiImagePayloads,
  handlePiResponseMessage,
  MAX_IMAGE_COUNT,
  MAX_TOTAL_IMAGE_BYTES,
} from '../session.js';

describe('isPathUnderRoot', () => {
  const root = path.resolve('/srv', 'uploads');

  it('accepts the root itself and paths nested under it', () => {
    expect(isPathUnderRoot(root, root)).toBe(true);
    expect(isPathUnderRoot(path.join(root, 'a.png'), root)).toBe(true);
    expect(isPathUnderRoot(path.join(root, 'nested', 'deep', 'b.png'), root)).toBe(true);
  });

  // The `+ path.sep` in the implementation is what makes this false. Dropping
  // it turns a plain `startsWith` into the classic sibling-prefix escape, where
  // a directory merely *named* like the root passes the containment check.
  it('rejects a sibling directory that shares the root as a string prefix', () => {
    expect(isPathUnderRoot(`${root}-evil/leak.png`, root)).toBe(false);
    expect(isPathUnderRoot(`${root}2/leak.png`, root)).toBe(false);
    expect(isPathUnderRoot(`${root}-evil`, root)).toBe(false);
  });

  it('rejects paths outside the root and parent directories', () => {
    expect(isPathUnderRoot(path.resolve('/etc', 'passwd'), root)).toBe(false);
    expect(isPathUnderRoot(path.dirname(root), root)).toBe(false);
    expect(isPathUnderRoot('', root)).toBe(false);
  });
});

describe('firstDialogOptionResult', () => {
  it('returns cancelled when opts is not an array', () => {
    expect(firstDialogOptionResult(undefined)).toEqual({ cancelled: true });
    expect(firstDialogOptionResult('nope')).toEqual({ cancelled: true });
  });

  it('returns cancelled for an empty array', () => {
    expect(firstDialogOptionResult([])).toEqual({ cancelled: true });
  });

  it('wraps a plain string option as { value }', () => {
    expect(firstDialogOptionResult(['first', 'second'])).toEqual({ value: 'first' });
  });

  it('uses the label field of an object option', () => {
    expect(firstDialogOptionResult([{ label: 'First Option', value: 'v1' }])).toEqual({ value: 'First Option' });
  });

  it('falls back to the value field when no label is present', () => {
    expect(firstDialogOptionResult([{ value: 'v1' }])).toEqual({ value: 'v1' });
  });

  it('falls back to an empty string when the first option is a bare object with neither label nor value', () => {
    expect(firstDialogOptionResult([{}])).toEqual({ value: '' });
  });
});

describe('piImageMimeType', () => {
  it('maps every known extension to its mime type', () => {
    expect(piImageMimeType('.png')).toBe('image/png');
    expect(piImageMimeType('.gif')).toBe('image/gif');
    expect(piImageMimeType('.webp')).toBe('image/webp');
  });

  it('falls back to image/jpeg for .jpg, .jpeg, and unrecognized extensions', () => {
    expect(piImageMimeType('.jpg')).toBe('image/jpeg');
    expect(piImageMimeType('.jpeg')).toBe('image/jpeg');
    expect(piImageMimeType('.bmp')).toBe('image/jpeg');
  });
});

describe('tryReadImagePayload / buildPiImagePayloads', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-rpc-handlers-test-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writeImage(name: string, bytes = 10): string {
    const p = path.join(dir, name);
    fs.writeFileSync(p, Buffer.alloc(bytes, 1));
    return p;
  }

  it('returns null for a non-string or empty path without touching the filesystem', () => {
    expect(tryReadImagePayload(undefined, dir, 0)).toBeNull();
    expect(tryReadImagePayload('', dir, 0)).toBeNull();
    expect(tryReadImagePayload(42, dir, 0)).toBeNull();
  });

  it('reads a valid image under uploadRoot and returns its base64 payload and size', () => {
    const imgPath = writeImage('a.png', 12);
    const result = tryReadImagePayload(imgPath, dir, 0);
    expect(result).not.toBeNull();
    expect(result!.payload.type).toBe('image');
    expect(result!.payload.mimeType).toBe('image/png');
    expect(result!.size).toBe(12);
    expect(Buffer.from(result!.payload.data, 'base64')).toHaveLength(12);
  });

  it('returns null for a path that does not resolve to a regular file', () => {
    const subdir = path.join(dir, 'sub.png');
    fs.mkdirSync(subdir);
    expect(tryReadImagePayload(subdir, dir, 0)).toBeNull();
  });

  it('returns null for a nonexistent path rather than throwing', () => {
    expect(tryReadImagePayload(path.join(dir, 'missing.png'), dir, 0)).toBeNull();
  });

  it('returns null when the resolved path escapes uploadRoot', () => {
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-rpc-outside-'));
    try {
      const imgPath = writeImage('b.png');
      expect(tryReadImagePayload(imgPath, outsideDir, 0)).toBeNull();
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it('returns null for a disallowed extension', () => {
    const imgPath = writeImage('c.txt');
    expect(tryReadImagePayload(imgPath, dir, 0)).toBeNull();
  });

  it('returns null when the remaining byte budget would be exceeded', () => {
    const imgPath = writeImage('d.png', 100);
    expect(tryReadImagePayload(imgPath, dir, MAX_TOTAL_IMAGE_BYTES - 50)).toBeNull();
  });

  it('skips the uploadRoot re-check entirely when uploadRoot is undefined', () => {
    const imgPath = writeImage('e.png');
    const result = tryReadImagePayload(imgPath, undefined, 0);
    expect(result).not.toBeNull();
  });

  it('buildPiImagePayloads returns an empty array for undefined or empty imagePaths', () => {
    expect(buildPiImagePayloads(undefined, dir)).toEqual([]);
    expect(buildPiImagePayloads([], dir)).toEqual([]);
  });

  it('buildPiImagePayloads accumulates valid images and skips invalid ones, preserving order', () => {
    const good1 = writeImage('f.png');
    const bad = writeImage('g.txt');
    const good2 = writeImage('h.gif');
    const images = buildPiImagePayloads([good1, bad, good2], dir);
    expect(images).toHaveLength(2);
    expect(images[0]!.mimeType).toBe('image/png');
    expect(images[1]!.mimeType).toBe('image/gif');
  });

  it('buildPiImagePayloads stops at MAX_IMAGE_COUNT even with more valid paths available', () => {
    const paths = Array.from({ length: MAX_IMAGE_COUNT + 3 }, (_, i) => writeImage(`img-${i}.png`));
    const images = buildPiImagePayloads(paths, dir);
    expect(images).toHaveLength(MAX_IMAGE_COUNT);
  });

  it('buildPiImagePayloads stops accepting once the total byte budget would be exceeded', () => {
    const big1 = writeImage('big1.png', MAX_TOTAL_IMAGE_BYTES - 100);
    const big2 = writeImage('big2.png', 200);
    const images = buildPiImagePayloads([big1, big2], dir);
    expect(images).toHaveLength(1);
  });
});

describe('handlePiResponseMessage', () => {
  it('fails the run when the parent-session response reports rejection', () => {
    const fail = vi.fn();
    const sendPromptCommand = vi.fn();
    handlePiResponseMessage({
      raw: { id: 1, success: false, error: 'no such session' },
      parentSessionRpcId: 1,
      promptRpcId: null,
      fail,
      sendPromptCommand,
    });
    expect(fail).toHaveBeenCalledWith('parent session rejected: no such session', 'PI_PARENT_SESSION_FAILED');
    expect(sendPromptCommand).not.toHaveBeenCalled();
  });

  it('uses "unknown" as the fallback when a rejected parent-session response carries no error field', () => {
    const fail = vi.fn();
    handlePiResponseMessage({
      raw: { id: 1, success: false },
      parentSessionRpcId: 1,
      promptRpcId: null,
      fail,
      sendPromptCommand: vi.fn(),
    });
    expect(fail).toHaveBeenCalledWith('parent session rejected: unknown', 'PI_PARENT_SESSION_FAILED');
  });

  it('sends the withheld prompt once the parent session is accepted', () => {
    const sendPromptCommand = vi.fn();
    handlePiResponseMessage({
      raw: { id: 1, success: true },
      parentSessionRpcId: 1,
      promptRpcId: null,
      fail: vi.fn(),
      sendPromptCommand,
    });
    expect(sendPromptCommand).toHaveBeenCalledOnce();
  });

  it('fails the run when the prompt response reports rejection', () => {
    const fail = vi.fn();
    handlePiResponseMessage({
      raw: { id: 2, success: false, error: 'boom' },
      parentSessionRpcId: null,
      promptRpcId: 2,
      fail,
      sendPromptCommand: vi.fn(),
    });
    expect(fail).toHaveBeenCalledWith('prompt rejected: boom');
  });

  it('is a no-op for a response id that matches neither parentSessionRpcId nor promptRpcId', () => {
    const fail = vi.fn();
    const sendPromptCommand = vi.fn();
    handlePiResponseMessage({
      raw: { id: 99, success: false },
      parentSessionRpcId: 1,
      promptRpcId: 2,
      fail,
      sendPromptCommand,
    });
    expect(fail).not.toHaveBeenCalled();
    expect(sendPromptCommand).not.toHaveBeenCalled();
  });

  it('is a no-op for a successful prompt response (nothing to report)', () => {
    const fail = vi.fn();
    handlePiResponseMessage({
      raw: { id: 2, success: true },
      parentSessionRpcId: null,
      promptRpcId: 2,
      fail,
      sendPromptCommand: vi.fn(),
    });
    expect(fail).not.toHaveBeenCalled();
  });
});
