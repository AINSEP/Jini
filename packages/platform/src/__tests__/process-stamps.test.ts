import { describe, expect, it } from 'vitest';
import {
  createProcessStampArgs,
  matchesProcessStamp,
  matchesStampedProcess,
  readFlagValue,
  readProcessStamp,
  readProcessStampFromCommand,
  type ProcessStampContract,
} from '../process.js';

type FakeStamp = { app: 'api' | 'ui'; namespace: string };

const fakeStampContract: ProcessStampContract<FakeStamp> = {
  stampFields: ['app', 'namespace'],
  stampFlags: { app: '--fake-app', namespace: '--fake-namespace' },
  normalizeStamp(input) {
    const value = input as Partial<FakeStamp>;
    if (value.app !== 'api' && value.app !== 'ui') throw new Error('invalid app');
    if (typeof value.namespace !== 'string' || value.namespace.length === 0) {
      throw new Error('invalid namespace');
    }
    return { app: value.app, namespace: value.namespace };
  },
  normalizeStampCriteria(input = {}) {
    const value = input as Partial<FakeStamp>;
    return {
      ...(value.app == null ? {} : { app: value.app }),
      ...(value.namespace == null ? {} : { namespace: value.namespace }),
    };
  },
};

describe('@jini-ai/platform — process — createProcessStampArgs', () => {
  it('encodes every stamp field as --flag=value', () => {
    expect(createProcessStampArgs<FakeStamp>({ stamp: { app: 'api', namespace: 'alpha' }, contract: fakeStampContract })).toEqual([
      '--fake-app=api',
      '--fake-namespace=alpha',
    ]);
  });

  it('throws when a normalized field is not a string', () => {
    type LooseStamp = { count: string; id: string };
    const throwingFieldContract: ProcessStampContract<LooseStamp> = {
      stampFields: ['id', 'count'],
      stampFlags: { count: '--count', id: '--id' },
      normalizeStamp: () => ({ count: 42 as unknown as string, id: 'abc' }),
      normalizeStampCriteria: (input) => (input ?? {}) as Partial<LooseStamp>,
    };
    expect(() => createProcessStampArgs({ stamp: { count: 'x', id: 'abc' }, contract: throwingFieldContract })).toThrow(
      /process stamp field count must normalize to a string/,
    );
  });
});

describe('@jini-ai/platform — process — readFlagValue', () => {
  it('reads both "--flag value" and inline "--flag=value" forms', () => {
    expect(readFlagValue({ args: ['--fake-app', 'ui'], flagName: '--fake-app' })).toBe('ui');
    expect(readFlagValue({ args: ['--fake-app=ui'], flagName: '--fake-app' })).toBe('ui');
  });

  it('returns null when the flag is absent', () => {
    expect(readFlagValue({ args: ['--other=1'], flagName: '--fake-app' })).toBeNull();
  });

  it('returns null when the flag is the last token with no following value', () => {
    expect(readFlagValue({ args: ['--fake-app'], flagName: '--fake-app' })).toBeNull();
  });
});

describe('@jini-ai/platform — process — readProcessStamp / readProcessStampFromCommand', () => {
  it('decodes a valid stamp from args and from a tokenized command line', () => {
    const args = createProcessStampArgs<FakeStamp>({ stamp: { app: 'ui', namespace: 'alpha' }, contract: fakeStampContract });
    expect(readProcessStamp({ args, contract: fakeStampContract })).toEqual({ app: 'ui', namespace: 'alpha' });
    expect(readProcessStampFromCommand({ command: `node   server.js   ${args.join('   ')}`, contract: fakeStampContract })).toEqual({
      app: 'ui',
      namespace: 'alpha',
    });
  });

  it('returns null when normalization fails (missing required field)', () => {
    expect(readProcessStamp({ args: ['--fake-app=ui'], contract: fakeStampContract })).toBeNull();
    expect(readProcessStampFromCommand({ command: 'node server.js --fake-app=ui', contract: fakeStampContract })).toBeNull();
  });
});

describe('@jini-ai/platform — process — matchesProcessStamp / matchesStampedProcess', () => {
  const stamp: FakeStamp = { app: 'ui', namespace: 'alpha' };

  it('matches when every specified criterion equals the stamp field, and unset criteria match anything', () => {
    expect(matchesProcessStamp({ stamp, criteria: { app: 'ui' }, contract: fakeStampContract })).toBe(true);
    expect(matchesProcessStamp({ stamp, criteria: undefined, contract: fakeStampContract })).toBe(true);
    expect(matchesProcessStamp({ stamp, criteria: { app: 'api' }, contract: fakeStampContract })).toBe(false);
  });

  it('decodes the command line and matches criteria against the resulting stamp', () => {
    const command = `node server.js ${createProcessStampArgs({ stamp, contract: fakeStampContract }).join(' ')}`;
    expect(matchesStampedProcess({ processInfo: { command }, criteria: { namespace: 'alpha' }, contract: fakeStampContract })).toBe(true);
  });

  it('returns false for a command whose stamp cannot be decoded', () => {
    expect(matchesStampedProcess({ processInfo: { command: 'node unrelated.js' }, criteria: { namespace: 'alpha' }, contract: fakeStampContract })).toBe(
      false,
    );
  });
});

