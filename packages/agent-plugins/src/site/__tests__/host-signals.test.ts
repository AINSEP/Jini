/**
 * @file Host signals declared by shipped plugins: the strict manifest parser, the hermetic bundled
 * reader (through injected source policy and text reader) and the resolver that hands the result to
 * the host's injected core policy. Host-independent: no product policy, only fakes and a temp dir.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import {
  parseHostSignalDeclaration,
  readBundledHostSignalDeclaration,
  resolveBundledHostSignals,
  type BundledHostSignalDeclaration,
} from './../host-signals.js';

const schema = 'https://agent-plugins.org/schemas/1.0.0/';
const manifest = (extension: unknown) => ({ $schema: `${schema}plugin.schema.json`, name: 'portable', extensions: { jini: extension } });
const signal = { env: 'EXAMPLE_APP', facts: { hosted: true, nativeToolsRestricted: true, trustProxyHops: 1 }, label: 'Example host' };

describe('parseHostSignalDeclaration', () => {
  it('returns the validated signals and the deployment advice from a neutral manifest', () => {
    expect(parseHostSignalDeclaration({ manifest: manifest({ hostSignals: [signal], deploymentAdvice: 'Set example mode.' }) })).toEqual({ signals: [signal], deploymentAdvice: 'Set example mode.' });
  });

  it('omits deploymentAdvice entirely when none is declared', () => {
    const parsed = parseHostSignalDeclaration({ manifest: manifest({ hostSignals: [{ env: 'EMPTY', facts: {} }] }) });
    expect(parsed).toEqual({ signals: [{ env: 'EMPTY', facts: {} }] });
    expect('deploymentAdvice' in parsed!).toBe(false);
  });

  it.each([
    ['not an object', 'text'], ['null', null], ['an array', []], ['no extensions', {}],
    ['no hostSignals', manifest({ summary: 'only presentation' })],
    ['advice with a line break (malformed advice drops the declaration)', manifest({ hostSignals: [signal], deploymentAdvice: 'bad\ncopy' })],
    ['a signal whose env is not text', manifest({ hostSignals: [{ ...signal, env: 1 }] })],
    ['a signal with an unknown fact', manifest({ hostSignals: [{ ...signal, facts: { unknown: true } }] })],
  ])('contributes nothing for %s', (_name, value) => {
    expect(parseHostSignalDeclaration({ manifest: value })).toBeUndefined();
  });
});

describe('readBundledHostSignalDeclaration', () => {
  const files = (byRoot: Record<string, unknown>) => ({
    sources: vi.fn(() => Object.keys(byRoot).map((packageRoot) => ({ packageRoot }))),
    readText: vi.fn((file: string) => { const found = byRoot[path.dirname(file)]; if (found instanceof Error) throw found; return typeof found === 'string' ? found : JSON.stringify(found); }),
  });
  const read = (byRoot: Record<string, unknown>) => {
    const harness = files(byRoot);
    return { harness, result: readBundledHostSignalDeclaration({ sourceRoot: '/bundled', sources: harness.sources }, { readText: harness.readText }) };
  };

  it('asks the injected policy for plugin.json under the source root and reads each package\'s manifest file', () => {
    const { harness } = read({ '/bundled/a': manifest({ hostSignals: [signal] }) });
    expect(harness.sources).toHaveBeenCalledWith({ sourceRoot: '/bundled', filename: 'plugin.json' });
    expect(harness.readText).toHaveBeenCalledWith(path.join('/bundled/a', 'plugin.json'));
  });

  it('combines signals across manifests and collapses identical advice into one', () => {
    const second = { env: 'ONLY_HERE', facts: { nativeToolsRestricted: true } };
    const { result } = read({
      '/bundled/a': manifest({ hostSignals: [signal], deploymentAdvice: 'Same advice' }),
      '/bundled/b': manifest({ hostSignals: [second], deploymentAdvice: 'Same advice' }),
    });
    expect(result).toEqual({ signals: [signal, second], deploymentAdvice: 'Same advice' });
  });

  it('keeps advice declared by only one manifest, and has none when no manifest declares any', () => {
    expect(read({ '/bundled/a': manifest({ hostSignals: [signal], deploymentAdvice: 'Only here' }), '/bundled/b': manifest({ hostSignals: [{ env: 'B', facts: {} }] }) }).result.deploymentAdvice).toBe('Only here');
    expect('deploymentAdvice' in read({ '/bundled/a': manifest({ hostSignals: [signal] }) }).result).toBe(false);
  });

  it('rejects the whole declaration when two manifests claim the same env, so the host keeps its complete fallback', () => {
    const { result } = read({
      '/bundled/a': manifest({ hostSignals: [signal], deploymentAdvice: 'Same advice' }),
      '/bundled/b': manifest({ hostSignals: [{ env: signal.env, facts: { hosted: false } }], deploymentAdvice: 'Same advice' }),
    });
    expect(result).toEqual({ signals: [] });
  });

  it('rejects the whole declaration when manifests disagree on the deployment advice', () => {
    const { result } = read({
      '/bundled/a': manifest({ hostSignals: [signal], deploymentAdvice: 'Advice one' }),
      '/bundled/b': manifest({ hostSignals: [{ env: 'B', facts: {} }], deploymentAdvice: 'Advice two' }),
    });
    expect(result).toEqual({ signals: [] });
  });

  it('never fails boot: an unreadable, unparsable or declaration-less manifest contributes nothing while its siblings still count', () => {
    const { result } = read({
      '/bundled/good': manifest({ hostSignals: [signal] }),
      '/bundled/unreadable': new Error('EACCES'),
      '/bundled/invalid-json': '{',
      '/bundled/absent': {},
      '/bundled/malformed': manifest({ hostSignals: [{ env: 'BAD', facts: { hosted: 'true' } }] }),
    });
    expect(result).toEqual({ signals: [signal] });
  });

  it('never fails boot when the bundled-source policy itself throws', () => {
    expect(readBundledHostSignalDeclaration({ sourceRoot: '/bundled', sources: () => { throw new Error('policy exploded'); } })).toEqual({ signals: [] });
  });

  describe('with the default text reader (node fs)', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'host-signals-'));
    afterAll(() => rmSync(root, { recursive: true, force: true }));
    const plugin = (name: string, body: string) => { mkdirSync(path.join(root, name), { recursive: true }); writeFileSync(path.join(root, name, 'plugin.json'), body); return path.join(root, name); };

    it('reads plugin.json from disk, treating a missing file as a contribution-less package', () => {
      const present = plugin('present', JSON.stringify(manifest({ hostSignals: [signal] })));
      const missing = path.join(root, 'missing');
      const sources = () => [{ packageRoot: present }, { packageRoot: missing }];
      expect(readBundledHostSignalDeclaration({ sourceRoot: root, sources })).toEqual({ signals: [signal] });
      expect(readBundledHostSignalDeclaration({ sourceRoot: root, sources }, { readText: null as never })).toEqual({ signals: [signal] });
    });
  });
});

describe('resolveBundledHostSignals', () => {
  const declaration: BundledHostSignalDeclaration = { signals: [{ env: 'EXAMPLE_APP', facts: { hosted: true } }] };
  const env = { EXAMPLE_APP: '1' };
  const policy = () => ({
    evaluateHostSignals: vi.fn((required: { env: unknown; declaration: BundledHostSignalDeclaration }) => ({ evaluated: required })),
    selectCoreHostSignalDeclaration: vi.fn((required: { declaration?: BundledHostSignalDeclaration }) => required.declaration ?? { signals: [], deploymentAdvice: 'core fallback' }),
  });

  it('reads the declaration for the bundled source root, lets the core policy select, and evaluates the env against the selection', () => {
    const ports = policy();
    const readDeclaration = vi.fn(() => declaration);
    const result = resolveBundledHostSignals({ bundledSourceRoot: '/bundled', env, sources: () => [], ...ports }, { readDeclaration });
    expect(readDeclaration).toHaveBeenCalledWith({ sourceRoot: '/bundled' });
    expect(ports.selectCoreHostSignalDeclaration).toHaveBeenCalledWith({ declaration });
    expect(ports.evaluateHostSignals).toHaveBeenCalledWith({ env, declaration });
    expect(result).toEqual({ evaluated: { env, declaration } });
  });

  it('falls back to the core declaration, never throwing, when the reader fails', () => {
    const ports = policy();
    const result = resolveBundledHostSignals({ bundledSourceRoot: '/bundled', env, sources: () => [], ...ports }, { readDeclaration: () => { throw new Error('boom'); } });
    expect(ports.selectCoreHostSignalDeclaration).toHaveBeenLastCalledWith({});
    expect(result).toEqual({ evaluated: { env, declaration: { signals: [], deploymentAdvice: 'core fallback' } } });
  });

  it('falls back to a fresh core evaluation when the first evaluation throws', () => {
    const ports = policy();
    ports.evaluateHostSignals.mockImplementationOnce(() => { throw new Error('evaluator failed'); });
    const result = resolveBundledHostSignals({ bundledSourceRoot: '/bundled', env, sources: () => [], ...ports }, { readDeclaration: () => declaration });
    expect(ports.evaluateHostSignals).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ evaluated: { env, declaration: { signals: [], deploymentAdvice: 'core fallback' } } });
  });

  it('without an injected reader, uses the bundled-source policy and the manifests on disk', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'host-signals-resolve-'));
    try {
      mkdirSync(path.join(root, 'p'));
      writeFileSync(path.join(root, 'p', 'plugin.json'), JSON.stringify(manifest({ hostSignals: [signal] })));
      const sources = vi.fn(() => [{ packageRoot: path.join(root, 'p') }]);
      const ports = policy();
      const result = resolveBundledHostSignals({ bundledSourceRoot: root, env, sources, ...ports });
      expect(sources).toHaveBeenCalledWith({ sourceRoot: root, filename: 'plugin.json' });
      expect(result).toEqual({ evaluated: { env, declaration: { signals: [signal] } } });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
