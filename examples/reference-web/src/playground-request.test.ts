import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';

import {
  createPlaygroundRuntimeEnvironment,
  decodePlaygroundRunRequest,
  failPlaygroundRunBeforeExecutor,
  promptWithPlaygroundAttachments,
  sanitizePlaygroundAttachmentName,
  writeBoundedAttachmentBody,
} from './playground-request.js';

const allowedProjects = new Set(['starter-site', 'bug-hunt']);
const repoRoot = resolve(import.meta.dirname, '../../..');
const uploadDirectory = resolve(repoRoot, '.jini/playground/uploads');
const attachmentId = (index: number) =>
  `attachment:00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`;

function encodeContext(payload: unknown, prefix = 'playground:'): string {
  return `${prefix}${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
}

describe('decodePlaygroundRunRequest', () => {
  it('normalizes allowed fields and preserves syntactically valid attachment claims', () => {
    const validAttachments = Array.from({ length: 2 }, (_, index) => ({
      path: attachmentId(index),
      name: `upload-${index}.png`,
      kind: index === 0 ? 'image' : 'file',
      ...(index === 0 ? { size: 42 } : {}),
    }));
    const decoded = decodePlaygroundRunRequest({
      contextRef: encodeContext({
        prompt: 'Inspect uploads',
        project: 'starter-site',
        model: '  gpt-5.6-sol  ',
        reasoning: ' high ',
        workingDirectory: ' examples/reference-web ',
        attachments: validAttachments,
      }),
      allowedProjects,
    });

    expect(decoded).toMatchObject({
      prompt: 'Inspect uploads',
      project: 'starter-site',
      model: 'gpt-5.6-sol',
      reasoning: 'high',
      workingDirectory: 'examples/reference-web',
    });
    expect(decoded.attachments).toHaveLength(2);
    expect(decoded.attachments?.[0]).toEqual({
      path: attachmentId(0),
      name: 'upload-0.png',
      kind: 'image',
      size: 42,
    });
  });

  it('fails closed for unsupported contexts, empty prompts, and unknown projects', () => {
    expect(() => decodePlaygroundRunRequest({
      contextRef: encodeContext({ prompt: 'ok', project: 'starter-site' }, 'other:'),
      allowedProjects,
    })).toThrow('unsupported run context');
    expect(() => decodePlaygroundRunRequest({
      contextRef: encodeContext({ prompt: ' ', project: 'starter-site' }),
      allowedProjects,
    })).toThrow('non-empty prompt');
    expect(() => decodePlaygroundRunRequest({
      contextRef: encodeContext({ prompt: 'ok', project: 'outside' }),
      allowedProjects,
    })).toThrow('unknown sample project');
    expect(() => decodePlaygroundRunRequest({
      contextRef: encodeContext({
        prompt: 'ok',
        project: 'starter-site',
        attachments: [{ path: '/tmp/outside', name: 'outside', kind: 'file' }],
      }),
      allowedProjects,
    })).toThrow('invalid attachment capability');
    expect(() => decodePlaygroundRunRequest({
      contextRef: encodeContext({
        prompt: 'ok',
        project: 'starter-site',
        attachments: Array.from({ length: 11 }, (_, index) => ({
          path: attachmentId(index),
          name: `${index}.txt`,
          kind: 'file',
        })),
      }),
      allowedProjects,
    })).toThrow('too many attachments');
  });

  it('omits invalid optional fields when no attachments are supplied', () => {
    expect(decodePlaygroundRunRequest({
      contextRef: encodeContext({
        prompt: 'ok',
        project: 'bug-hunt',
        model: ' ',
        reasoning: 7,
        workingDirectory: '',
      }),
      allowedProjects,
    })).toEqual({ prompt: 'ok', project: 'bug-hunt' });
  });
});

describe('playground upload boundaries', () => {
  it('strips path components/control characters and provides a safe fallback name', () => {
    expect(sanitizePlaygroundAttachmentName('../../evil\nname?.png')).toBe('evil_name_.png');
    expect(sanitizePlaygroundAttachmentName('???')).toBe('___');
    expect(sanitizePlaygroundAttachmentName(null)).toBe('attachment');
    expect(sanitizePlaygroundAttachmentName('')).toBe('attachment');
  });

  it('streams mixed chunks privately and removes a max-plus-one partial file', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'jini-upload-test-'));
    const validPath = resolve(directory, 'valid.bin');
    const oversizedPath = resolve(directory, 'oversized.bin');
    async function* validBody() {
      yield Buffer.from('ab');
      yield 'cd';
    }
    async function* oversizedBody() {
      yield Buffer.from('12345');
    }
    await expect(writeBoundedAttachmentBody({
      request: validBody(),
      filePath: validPath,
      maxBytes: 4,
    })).resolves.toEqual({
      size: 4,
      signature: Buffer.from('abcd'),
    });
    expect(await readFile(validPath, 'utf8')).toBe('abcd');
    expect((await stat(validPath)).mode & 0o777).toBe(0o600);
    await expect(writeBoundedAttachmentBody({
      request: oversizedBody(),
      filePath: oversizedPath,
      maxBytes: 4,
    })).rejects.toThrow('20 MB playground limit');
    await expect(stat(oversizedPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await rm(directory, { recursive: true, force: true });
  });
});

describe('playground runtime input forwarding', () => {
  it('forwards only narrow runtime environment values to agent children', () => {
    expect(createPlaygroundRuntimeEnvironment({
      PATH: '/usr/bin',
      HOME: '/Users/test',
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      JINI_PLAYGROUND_GRANT_SECRET: 'grant-secret',
      UNRELATED_API_KEY: 'secret',
    })).toEqual({
      PATH: '/usr/bin',
      HOME: '/Users/test',
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
    });
  });

  it('emits and terminalizes only pre-executor failures', async () => {
    const emit = vi.fn(async () => undefined);
    const finish = vi.fn(async () => undefined);
    const running = {
      get: vi.fn(async () => ({ state: 'running' })),
      emit,
      finish,
    };
    await expect(failPlaygroundRunBeforeExecutor({
      lifecycle: running,
      runId: 'run-1',
    })).resolves.toBe(true);
    expect(emit).toHaveBeenCalledWith('run-1', {
      event: 'error',
      data: {
        message: 'The run could not start because its local inputs are unavailable or no longer approved.',
      },
    });
    expect(finish).toHaveBeenCalledWith({
      runId: 'run-1',
      status: 'failed',
      code: null,
      signal: null,
      resumable: false,
    });

    const terminal = {
      ...running,
      get: vi.fn(async () => ({ state: 'failed' })),
    };
    await expect(failPlaygroundRunBeforeExecutor({
      lifecycle: terminal,
      runId: 'run-2',
    })).resolves.toBe(false);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledTimes(1);
  });

  it('adds the validated attachment manifest only when attachments exist', () => {
    const request = {
      prompt: 'Use this file',
      project: 'starter-site',
      attachments: [{
        path: resolve(uploadDirectory, 'reference.png'),
        name: 'reference.png',
        kind: 'image' as const,
      }],
    };
    expect(promptWithPlaygroundAttachments(request)).toContain(
      `- image: reference.png (${resolve(uploadDirectory, 'reference.png')})`,
    );
    expect(promptWithPlaygroundAttachments({
      prompt: 'No files',
      project: 'starter-site',
    })).toBe('No files');
  });
});
