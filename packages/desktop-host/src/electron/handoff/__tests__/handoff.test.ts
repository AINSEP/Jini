/** Sender check, window settlement and payload forwarding for the app-window hand-off. */
import { expect, it } from 'vitest';
import { registerHandoffForwarding, type HandoffIpcMain, type HandoffWindow } from '../index.js';

type Handler = Parameters<HandoffIpcMain['handle']>[1];
const channels = { request: 'host:screen:open', open: 'host:screen:show' };

function fakeWindow({ minimized = false } = {}) {
  const calls: unknown[][] = [];
  const window: HandoffWindow<{ address?: string }> = {
    isMinimized: () => minimized,
    restore: () => { calls.push(['restore']); },
    show: () => { calls.push(['show']); },
    focus: () => { calls.push(['focus']); },
    webContents: { send: (channel, payload) => { calls.push(['send', channel, payload]); } },
  };
  return { window, calls };
}

function register(windows: HandoffWindow<{ address?: string }>[]) {
  const handlers = new Map<string, Handler>();
  registerHandoffForwarding({
    ipcMain: { handle: (channel, handler) => { handlers.set(channel, handler); } },
    isTrustedSender: ({ senderUrl }) => senderUrl.startsWith('https://shell.test/'),
    windows: () => windows,
    channels,
    parse: ({ raw }) => (typeof raw === 'string' ? { address: raw.trim() } : {}),
    senderRefused: 'refused: not a shell page',
  });
  const handler = handlers.get(channels.request);
  if (!handler) throw new Error('no handler registered');
  return (raw: unknown, url?: unknown) => handler(url === undefined ? undefined : { senderFrame: { url } }, raw);
}

it('forwards the parsed payload to the first window after restoring, showing and focusing it', () => {
  const first = fakeWindow({ minimized: true });
  const second = fakeWindow();
  const call = register([first.window, second.window]);
  expect(call('  https://example.com ', 'https://shell.test/admin')).toEqual({ opened: true });
  expect(first.calls).toEqual([['restore'], ['show'], ['focus'], ['send', channels.open, { address: 'https://example.com' }]]);
  expect(second.calls).toEqual([]);
});

it('does not restore a window that is not minimized', () => {
  const only = fakeWindow();
  register([only.window])('x', 'https://shell.test/');
  expect(only.calls.map(([name]) => name)).toEqual(['show', 'focus', 'send']);
});

it('answers opened: false when no app window is open', () => {
  expect(register([])('x', 'https://shell.test/')).toEqual({ opened: false });
});

it('refuses an untrusted, missing or non-string sender URL with the host wording and touches no window', () => {
  const only = fakeWindow();
  const call = register([only.window]);
  expect(() => call('x', 'https://evil.test/')).toThrow('refused: not a shell page');
  expect(() => call('x')).toThrow('refused: not a shell page');
  expect(() => call('x', 42)).toThrow('refused: not a shell page');
  expect(only.calls).toEqual([]);
});
