import { describe, expect, it, vi } from 'vitest';
import { CommandRegistry } from '../command-registry.js';

describe('CommandRegistry', () => {
  it('reports empty when argv has no positional token', async () => {
    const registry = new CommandRegistry();
    const result = await registry.dispatch({ argv: ['--json'] });
    expect(result).toEqual({ kind: 'empty' });
  });

  it('reports not-found for an unregistered command name', async () => {
    const registry = new CommandRegistry();
    const result = await registry.dispatch({ argv: ['bogus'] });
    expect(result).toEqual({ kind: 'not-found', name: 'bogus' });
  });

  it('dispatches to a registered handler with the command name removed', async () => {
    const registry = new CommandRegistry();
    const handler = vi.fn();
    registry.add({ name: 'run', handler });
    const result = await registry.dispatch({ argv: ['run', 'start', '--json'] });
    expect(result).toEqual({ kind: 'handled' });
    expect(handler).toHaveBeenCalledWith({ args: ['start', '--json'] });
  });

  it('preserves flags that appear before the command name', async () => {
    const registry = new CommandRegistry();
    const handler = vi.fn();
    registry.add({ name: 'run', handler });
    const result = await registry.dispatch({ argv: ['--verbose', 'run', 'start'] });
    expect(result).toEqual({ kind: 'handled' });
    expect(handler).toHaveBeenCalledWith({ args: ['--verbose', 'start'] });
  });

  it('awaits an async handler', async () => {
    const registry = new CommandRegistry();
    let resolved = false;
    registry.add({ name: 'slow', handler: async () => {
      await Promise.resolve();
      resolved = true;
    } });
    await registry.dispatch({ argv: ['slow'] });
    expect(resolved).toBe(true);
  });

  it('throws when re-registering an already-used command name', () => {
    const registry = new CommandRegistry();
    registry.add({ name: 'run', handler: vi.fn() });
    expect(() => registry.add({ name: 'run', handler: vi.fn() })).toThrow(/already registered/);
  });

  it('replaces an existing registration when { override: true } is passed', async () => {
    const registry = new CommandRegistry();
    const first = vi.fn();
    const second = vi.fn();
    registry.add({ name: 'run', handler: first });
    registry.add({ name: 'run', handler: second }, { override: true });
    await registry.dispatch({ argv: ['run'] });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalled();
  });

  it('does not mistake a value-flag\'s own value for the command name', async () => {
    const registry = new CommandRegistry();
    const handler = vi.fn();
    registry.add({ name: 'run', handler });
    const result = await registry.dispatch({ argv: ['--daemon-url', 'http://127.0.0.1:4111', 'run'] }, {
      valueFlags: new Set(['daemon-url']),
    });
    expect(result).toEqual({ kind: 'handled' });
    expect(handler).toHaveBeenCalledWith({ args: ['--daemon-url', 'http://127.0.0.1:4111'] });
  });

  it('skips multiple value-flags before finding the command name', async () => {
    const registry = new CommandRegistry();
    const handler = vi.fn();
    registry.add({ name: 'run', handler });
    const result = await registry.dispatch({ argv: ['--daemon-url', 'http://127.0.0.1:4111', '--token', 'abc123', 'run', 'start'] }, { valueFlags: new Set(['daemon-url', 'token']) });
    expect(result).toEqual({ kind: 'handled' });
    expect(handler).toHaveBeenCalledWith({ args: ['--daemon-url', 'http://127.0.0.1:4111', '--token', 'abc123', 'start'] });
  });

  it('treats an unknown flag as boolean (no value skip) when it is not in valueFlags', async () => {
    const registry = new CommandRegistry();
    const handler = vi.fn();
    registry.add({ name: 'run', handler });
    // Without declaring `daemon-url` as a value flag, its value token is
    // itself non-`-`-prefixed and is (still, correctly) treated as the first
    // positional token — this documents the pre-existing limitation that
    // `valueFlags` must be supplied for the dispatcher to know which flags
    // consume a value; it does not infer that from shape alone.
    const result = await registry.dispatch({ argv: ['--daemon-url', 'http://127.0.0.1:4111', 'run'] });
    expect(result).toEqual({ kind: 'not-found', name: 'http://127.0.0.1:4111' });
  });

  it('handles a `--flag=value` token without consuming the following token', async () => {
    const registry = new CommandRegistry();
    const handler = vi.fn();
    registry.add({ name: 'run', handler });
    const result = await registry.dispatch({ argv: ['--daemon-url=http://127.0.0.1:4111', 'run'] }, {
      valueFlags: new Set(['daemon-url']),
    });
    expect(result).toEqual({ kind: 'handled' });
    expect(handler).toHaveBeenCalledWith({ args: ['--daemon-url=http://127.0.0.1:4111'] });
  });

  it('has() reflects registered command names', () => {
    const registry = new CommandRegistry();
    expect(registry.has({ name: 'run' })).toBe(false);
    registry.add({ name: 'run', handler: () => {} });
    expect(registry.has({ name: 'run' })).toBe(true);
  });

  it('names() lists every registered command in insertion order', () => {
    const registry = new CommandRegistry();
    registry.add({ name: 'a', handler: () => {} });
    registry.add({ name: 'b', handler: () => {} });
    expect(registry.names()).toEqual(['a', 'b']);
  });

  it('usageFor() returns the registered usage text', () => {
    const registry = new CommandRegistry();
    registry.add({ name: 'run', handler: () => {} }, { usage: 'Usage: run ...' });
    expect(registry.usageFor({ name: 'run' })).toBe('Usage: run ...');
  });

  it('usageFor() returns undefined when no usage was registered', () => {
    const registry = new CommandRegistry();
    registry.add({ name: 'run', handler: () => {} });
    expect(registry.usageFor({ name: 'run' })).toBeUndefined();
  });

  it('usageFor() returns undefined for an unregistered command', () => {
    const registry = new CommandRegistry();
    expect(registry.usageFor({ name: 'bogus' })).toBeUndefined();
  });
});
