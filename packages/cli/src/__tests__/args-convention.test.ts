import { expect, test, vi } from 'vitest';
import { sanitizeUntrustedText } from '@jini-ai/core/text';
import { CommandRegistry, parseFlags, renderUsage } from '../index.js';

test('required CLI inputs and optional policy use separate objects', async () => {
  expect(parseFlags({ argv: ['--name', 'Ada'] }, { string: new Set(['name']) })).toEqual({ name: 'Ada' });
  expect(renderUsage({ usage: ['example'] }, { description: 'Example command' })).toBe('Usage:\n  example\n\nExample command');
  expect(sanitizeUntrustedText({ text: 'abcdef' }, { maxLength: 3 })).toBe('… [');
  const handler = vi.fn();
  const registry = new CommandRegistry({});
  registry.add({ name: 'example', handler }, { usage: 'example' });
  expect(await registry.dispatch({ argv: ['example', 'value'] })).toEqual({ kind: 'handled' });
  expect(handler).toHaveBeenCalledWith({ args: ['value'] });
});
