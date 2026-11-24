import { describe, expect, it } from 'vitest';
import { registerPreferenceIpc } from '../ipc.js';

type Handler = (event: { sender: string }, value?: unknown) => number;

function setup({ removable = true }: { removable?: boolean } = {}) {
  const handlers = new Map<string, Handler>();
  const removed: string[] = [];
  const calls: string[] = [];
  const ipcMain = {
    handle: (channel: string, handler: Handler) => { handlers.set(channel, handler); },
    ...(removable ? { removeHandler: (channel: string) => { removed.push(channel); handlers.delete(channel); } } : {}),
  };
  const off = registerPreferenceIpc<string, number>({
    ipcMain, channels: { read: 'pref:read', write: 'pref:write' },
    allowed: ({ sender }) => sender === 'shell', untrustedError: 'UNTRUSTED_SENDER',
    parse: ({ value }) => { calls.push('parse'); if (typeof value !== 'number') throw new Error('INVALID_VALUE'); return value; },
    read: () => { calls.push('read'); return 3; },
    write: ({ value }) => { calls.push(`write:${value}`); return value * 10; },
  });
  return { handlers, removed, calls, off };
}

describe('registerPreferenceIpc', () => {
  it('serves trusted reads and parsed writes on the host channels', () => {
    const { handlers, calls } = setup();
    expect([...handlers.keys()]).toEqual(['pref:read', 'pref:write']);
    expect(handlers.get('pref:read')!({ sender: 'shell' })).toBe(3);
    expect(handlers.get('pref:write')!({ sender: 'shell' }, 2)).toBe(20);
    expect(calls).toEqual(['read', 'parse', 'write:2']);
  });

  it('refuses untrusted senders before any storage or parsing, and rejects invalid values before saving', () => {
    const { handlers, calls } = setup();
    expect(() => handlers.get('pref:read')!({ sender: 'guest' })).toThrow('UNTRUSTED_SENDER');
    expect(() => handlers.get('pref:write')!({ sender: 'guest' }, 2)).toThrow('UNTRUSTED_SENDER');
    expect(calls).toEqual([]);
    expect(() => handlers.get('pref:write')!({ sender: 'shell' }, 'x')).toThrow('INVALID_VALUE');
    expect(calls).toEqual(['parse']);
  });

  it('teardown removes both handlers, and is a no-op when the host ipc cannot remove', () => {
    const removable = setup();
    removable.off();
    expect(removable.removed).toEqual(['pref:read', 'pref:write']);
    expect(removable.handlers.size).toBe(0);
    const fixed = setup({ removable: false });
    expect(() => fixed.off()).not.toThrow();
    expect(fixed.handlers.size).toBe(2);
  });
});
