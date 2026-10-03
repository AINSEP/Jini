import { afterEach, describe, expect, it } from 'vitest';
import { agentCapabilities } from '../../capabilities.js';
import { geminiAgentDef } from '../gemini.js';
import { DEFAULT_MODEL_OPTION } from '../shared.js';
import { getAgentDef } from '../../registry.js';

afterEach(() => {
  agentCapabilities.delete('gemini');
});

const BASE = ['--output-format', 'stream-json'];
const YOLO = ['--approval-mode', 'yolo'];

describe('geminiAgentDef.buildArgs', () => {
  it('builds stream-json + yolo argv with no capabilities, model, or extra dirs', () => {
    expect(geminiAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: [], options: {} })).toEqual([...BASE, ...YOLO]);
  });

  it('defaults extraAllowedDirs and options when omitted entirely', () => {
    expect(geminiAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] })).toEqual([...BASE, ...YOLO]);
  });

  it('never puts the prompt in argv (it goes over stdin)', () => {
    expect(geminiAgentDef.buildArgs({ prompt: 'secret prompt text', imagePaths: [] }, { extraAllowedDirs: [], options: {} })).not.toContain('secret prompt text');
    expect(geminiAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: [], options: {} })).not.toContain('-p');
  });

  it('adds --skip-trust when the --help probe recorded it', () => {
    agentCapabilities.set('gemini', { skipTrust: true });
    expect(geminiAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: [], options: {} })).toEqual([...BASE, '--skip-trust', ...YOLO]);
  });

  it('keeps --skip-trust in restricted mode (trust is about the cwd, not tool approval)', () => {
    agentCapabilities.set('gemini', { skipTrust: true });
    expect(geminiAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: [], options: { permissionMode: 'restricted' } })).toEqual([
      ...BASE,
      '--skip-trust',
    ]);
  });

  it('omits --skip-trust when the probe recorded it as absent', () => {
    agentCapabilities.set('gemini', { skipTrust: false });
    expect(geminiAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: [], options: {} })).toEqual([...BASE, ...YOLO]);
  });

  it('omits --approval-mode yolo when permissionMode is "restricted"', () => {
    expect(geminiAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: [], options: { permissionMode: 'restricted' } })).toEqual(BASE);
  });

  it('adds --model for a non-default model', () => {
    expect(geminiAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: [], options: { model: 'gemini-2.5-pro' } })).toEqual([
      ...BASE,
      ...YOLO,
      '--model',
      'gemini-2.5-pro',
    ]);
  });

  it('omits --model for the literal "default"', () => {
    expect(geminiAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: [], options: { model: 'default' } })).toEqual([...BASE, ...YOLO]);
  });

  it('adds one --include-directories per non-empty extra dir', () => {
    expect(geminiAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: ['/a', '', '/b'], options: {} })).toEqual([
      ...BASE,
      ...YOLO,
      '--include-directories',
      '/a',
      '--include-directories',
      '/b',
    ]);
  });
});

describe('geminiAgentDef shape', () => {
  it('declares the expected static metadata', () => {
    expect(geminiAgentDef.id).toBe('gemini');
    expect(geminiAgentDef.name).toBe('Gemini CLI');
    expect(geminiAgentDef.bin).toBe('gemini');
    expect(geminiAgentDef.versionArgs).toEqual(['--version']);
    expect(geminiAgentDef.helpArgs).toEqual(['--help']);
    expect(geminiAgentDef.capabilityFlags).toEqual({ '--skip-trust': 'skipTrust' });
    expect(geminiAgentDef.fallbackModels[0]).toEqual(DEFAULT_MODEL_OPTION);
    expect(geminiAgentDef.promptViaStdin).toBe(true);
    expect(geminiAgentDef.streamFormat).toBe('json-event-stream');
    expect(geminiAgentDef.eventParser).toBe('gemini');
  });

  it('is registered in the built-in catalog', () => {
    expect(getAgentDef({ id: 'gemini' })).toBe(geminiAgentDef);
  });
});
