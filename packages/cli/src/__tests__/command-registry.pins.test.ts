import { describe, expect, it } from 'vitest';
import { CommandRegistry, type CommandHandler } from '../command-registry.js';

// Characterization pins for CommandRegistry.dispatch's command-name scan,
// written against the pre-refactor code.

function recorder(): { handler: CommandHandler; calls: Array<readonly string[]> } {
  const calls: Array<readonly string[]> = [];
  return { handler: ({ args }) => { calls.push(args); }, calls };
}

const VF = new Set(['daemon-url']);

describe('CommandRegistry.dispatch scan pins', () => {
  it('reports empty when a value-flag swallows the only positional', async () => {
    const reg = new CommandRegistry();
    expect(await reg.dispatch({ argv: ['--daemon-url', 'run'] }, { valueFlags: VF })).toEqual({ kind: 'empty' });
  });

  it('reports empty for a trailing value-flag with no value', async () => {
    const reg = new CommandRegistry();
    expect(await reg.dispatch({ argv: ['--daemon-url'] }, { valueFlags: VF })).toEqual({ kind: 'empty' });
  });

  it('does not skip after a single-dash token even if its name is a value-flag', async () => {
    const { handler, calls } = recorder();
    const reg = new CommandRegistry().add({ name: 'run', handler });
    expect(await reg.dispatch({ argv: ['-daemon-url', 'run'] }, { valueFlags: VF })).toEqual({ kind: 'handled' });
    expect(calls).toEqual([['-daemon-url']]);
  });

  it('does not skip after --flag=value even when the flag is a value-flag', async () => {
    const { handler, calls } = recorder();
    const reg = new CommandRegistry().add({ name: 'run', handler });
    await reg.dispatch({ argv: ['--daemon-url=http://127.0.0.1:1', 'run', 'x'] }, { valueFlags: VF });
    expect(calls).toEqual([['--daemon-url=http://127.0.0.1:1', 'x']]);
  });

  it('never skips after a token containing "=", even when the whole token text is a value-flag name', async () => {
    const { handler, calls } = recorder();
    const reg = new CommandRegistry().add({ name: 'run', handler });
    await reg.dispatch({ argv: ['--a=b', 'run'] }, { valueFlags: new Set(['a=b']) });
    expect(calls).toEqual([['--a=b']]);
  });

  it('a bare "--" is a flag token, not a stop marker', async () => {
    const { handler, calls } = recorder();
    const reg = new CommandRegistry().add({ name: 'run', handler });
    await reg.dispatch({ argv: ['--', 'run'] });
    expect(calls).toEqual([['--']]);
  });

  it('passes the skipped value token through to the handler', async () => {
    const { handler, calls } = recorder();
    const reg = new CommandRegistry().add({ name: 'run', handler });
    await reg.dispatch({ argv: ['--daemon-url', 'http://127.0.0.1:1', 'run', '--x'] }, { valueFlags: VF });
    expect(calls).toEqual([['--daemon-url', 'http://127.0.0.1:1', '--x']]);
  });

  it('reports not-found with the first positional name', async () => {
    const reg = new CommandRegistry();
    expect(await reg.dispatch({ argv: ['--q', 'nope', 'run'] })).toEqual({ kind: 'not-found', name: 'nope' });
  });

  it('dispatches the empty-string token as a command name', async () => {
    const { handler, calls } = recorder();
    const reg = new CommandRegistry().add({ name: '', handler });
    expect(await reg.dispatch({ argv: ['', 'a'] })).toEqual({ kind: 'handled' });
    expect(calls).toEqual([['a']]);
  });

  it('propagates a handler rejection', async () => {
    const reg = new CommandRegistry().add({ name: 'run', handler: async () => { throw new Error('handler failed'); } });
    await expect(reg.dispatch({ argv: ['run'] })).rejects.toThrow('handler failed');
  });
});
