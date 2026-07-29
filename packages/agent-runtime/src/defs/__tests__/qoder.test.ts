import { describe, expect, it } from 'vitest';
import { qoderAgentDef } from '../qoder.js';
import { DEFAULT_MODEL_OPTION } from '../shared.js';

const BASE_ARGS = ['-p', '--output-format', 'stream-json', '--yolo'];

describe('qoderAgentDef.buildArgs', () => {
  it('builds the base argv with no cwd, model, extra dirs, or attachments', () => {
    expect(qoderAgentDef.buildArgs('hi', [], [], {}, {})).toEqual(BASE_ARGS);
  });

  it('defaults imagePaths/extraAllowedDirs/options/runtimeContext when omitted', () => {
    expect(qoderAgentDef.buildArgs('hi', undefined as unknown as string[])).toEqual(BASE_ARGS);
  });

  it('adds -w <cwd> when runtimeContext.cwd is set', () => {
    expect(qoderAgentDef.buildArgs('hi', [], [], {}, { cwd: '/project' })).toEqual([
      ...BASE_ARGS,
      '-w',
      '/project',
    ]);
  });

  it('omits -w when runtimeContext.cwd is unset', () => {
    expect(qoderAgentDef.buildArgs('hi', [], [], {}, {})).toEqual(BASE_ARGS);
  });

  it('adds --model when a non-default model is selected', () => {
    expect(qoderAgentDef.buildArgs('hi', [], [], { model: 'ultimate' }, {})).toEqual([
      ...BASE_ARGS,
      '--model',
      'ultimate',
    ]);
  });

  it('omits --model when the model is the literal string "default"', () => {
    expect(qoderAgentDef.buildArgs('hi', [], [], { model: 'default' }, {})).toEqual(BASE_ARGS);
  });

  it('adds --add-dir for each absolute extraAllowedDirs entry, filtering out relative/non-string ones', () => {
    const args = qoderAgentDef.buildArgs(
      'hi',
      [],
      ['/abs/one', 'relative/two', 123 as unknown as string, '/abs/three'],
      {},
      {},
    );
    expect(args).toEqual([...BASE_ARGS, '--add-dir', '/abs/one', '--add-dir', '/abs/three']);
  });

  it('treats an omitted extraAllowedDirs as empty (parameter default)', () => {
    expect(qoderAgentDef.buildArgs('hi', [], undefined, {}, {})).toEqual(BASE_ARGS);
  });

  it('treats an explicit null extraAllowedDirs as empty (the `|| []` fallback, not the parameter default)', () => {
    expect(qoderAgentDef.buildArgs('hi', [], null as unknown as string[], {}, {})).toEqual(BASE_ARGS);
  });

  it('adds --attachment for each absolute imagePaths entry, filtering out relative/non-string ones', () => {
    const args = qoderAgentDef.buildArgs(
      'hi',
      ['/img/one.png', 'relative/two.png', 123 as unknown as string, '/img/three.png'],
      [],
      {},
      {},
    );
    expect(args).toEqual([...BASE_ARGS, '--attachment', '/img/one.png', '--attachment', '/img/three.png']);
  });

  it('treats a nullish imagePaths as empty', () => {
    expect(qoderAgentDef.buildArgs('hi', null as unknown as string[], [], {}, {})).toEqual(BASE_ARGS);
  });

  it('omits --yolo entirely when permissionMode is "restricted"', () => {
    expect(qoderAgentDef.buildArgs('hi', [], [], { permissionMode: 'restricted' }, {})).toEqual([
      '-p',
      '--output-format',
      'stream-json',
    ]);
  });

  it('composes cwd, model, dirs, and attachments together', () => {
    const args = qoderAgentDef.buildArgs(
      'hi',
      ['/img.png'],
      ['/extra'],
      { model: 'lite' },
      { cwd: '/proj' },
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
