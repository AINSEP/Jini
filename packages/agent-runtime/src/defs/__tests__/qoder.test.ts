import { describe, expect, it } from 'vitest';
import { qoderAgentDef } from '../qoder.js';
import { DEFAULT_MODEL_OPTION } from '../shared.js';

const BASE_ARGS = ['-p', '--output-format', 'stream-json', '--yolo'];

describe('qoderAgentDef.buildArgs', () => {
  it('builds the base argv with no cwd, model, extra dirs, or attachments', () => {
    expect(qoderAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: [], options: {}, runtimeContext: {} })).toEqual(BASE_ARGS);
  });

  it('defaults imagePaths/extraAllowedDirs/options/runtimeContext when omitted', () => {
    expect(qoderAgentDef.buildArgs({ prompt: 'hi', imagePaths: undefined as unknown as string[] })).toEqual(BASE_ARGS);
  });

  it('adds -w <cwd> when runtimeContext.cwd is set', () => {
    expect(qoderAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: [], options: {}, runtimeContext: { cwd: '/project' } })).toEqual([
      ...BASE_ARGS,
      '-w',
      '/project',
    ]);
  });

  it('omits -w when runtimeContext.cwd is unset', () => {
    expect(qoderAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: [], options: {}, runtimeContext: {} })).toEqual(BASE_ARGS);
  });

  it('adds --model when a non-default model is selected', () => {
    expect(qoderAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: [], options: { model: 'ultimate' }, runtimeContext: {} })).toEqual([
      ...BASE_ARGS,
      '--model',
      'ultimate',
    ]);
  });

  it('omits --model when the model is the literal string "default"', () => {
    expect(qoderAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: [], options: { model: 'default' }, runtimeContext: {} })).toEqual(BASE_ARGS);
  });

  it('adds --add-dir for each absolute extraAllowedDirs entry, filtering out relative/non-string ones', () => {
    const args = qoderAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: ['/abs/one', 'relative/two', 123 as unknown as string, '/abs/three'], options: {}, runtimeContext: {} }
    );
    expect(args).toEqual([...BASE_ARGS, '--add-dir', '/abs/one', '--add-dir', '/abs/three']);
  });

  it('treats an omitted extraAllowedDirs as empty (parameter default)', () => {
    expect(qoderAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { options: {}, runtimeContext: {} })).toEqual(BASE_ARGS);
  });

  it('treats an explicit null extraAllowedDirs as empty (the `|| []` fallback, not the parameter default)', () => {
    expect(qoderAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: null as unknown as string[], options: {}, runtimeContext: {} })).toEqual(BASE_ARGS);
  });

  it('adds --attachment for each absolute imagePaths entry, filtering out relative/non-string ones', () => {
    const args = qoderAgentDef.buildArgs({ prompt: 'hi', imagePaths: ['/img/one.png', 'relative/two.png', 123 as unknown as string, '/img/three.png'] }, { extraAllowedDirs: [], options: {}, runtimeContext: {} }
    );
    expect(args).toEqual([...BASE_ARGS, '--attachment', '/img/one.png', '--attachment', '/img/three.png']);
  });

  it('treats a nullish imagePaths as empty', () => {
    expect(qoderAgentDef.buildArgs({ prompt: 'hi', imagePaths: null as unknown as string[] }, { extraAllowedDirs: [], options: {}, runtimeContext: {} })).toEqual(BASE_ARGS);
  });

  it('omits --yolo entirely when permissionMode is "restricted"', () => {
    expect(qoderAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: [], options: { permissionMode: 'restricted' }, runtimeContext: {} })).toEqual([
      '-p',
      '--output-format',
      'stream-json',
    ]);
  });

  it('composes cwd, model, dirs, and attachments together', () => {
    const args = qoderAgentDef.buildArgs({ prompt: 'hi', imagePaths: ['/img.png'] }, { extraAllowedDirs: ['/extra'], options: { model: 'lite' }, runtimeContext: { cwd: '/proj' } }
    );
    expect(args).toEqual([
      ...BASE_ARGS,
      '-w',
      '/proj',
      '--model',
      'lite',
      '--add-dir',
      '/extra',
      '--attachment',
      '/img.png',
    ]);
  });
});

describe('qoderAgentDef shape', () => {
  it('declares the expected static metadata', () => {
    expect(qoderAgentDef.id).toBe('qoder');
    expect(qoderAgentDef.bin).toBe('qodercli');
    expect(qoderAgentDef.fallbackModels).toContainEqual(DEFAULT_MODEL_OPTION);
    expect(qoderAgentDef.fallbackModels.length).toBeGreaterThan(1);
    expect(qoderAgentDef.promptViaStdin).toBe(true);
    expect(qoderAgentDef.streamFormat).toBe('qoder-stream-json');
  });
});
