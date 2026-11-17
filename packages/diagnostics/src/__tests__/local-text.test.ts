import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { redactLocalText } from '../local-text.js';

afterEach(() => vi.restoreAllMocks());

it("masks a home outside /Users and /home (root's /root), which the username policy alone misses", () => {
  const out = redactLocalText({ text: 'load failed: /root/private/addon.node and "/root"' }, { homeDir: '/root' });
  expect(out).toBe('load failed: ~/private/addon.node and "~"');
});

it('keeps the shared /home/<USER> and /Users/<USER> masking for a conventional home', () => {
  expect(redactLocalText({ text: 'at /home/dev/app.ts' }, { homeDir: '/home/dev' })).toBe('at /home/<USER>/app.ts');
  expect(redactLocalText({ text: 'at /Users/dev/app.ts' }, { homeDir: '/Users/dev' })).toBe('at /Users/<USER>/app.ts');
});

it('leaves a sibling path that only shares the home prefix readable', () => {
  expect(redactLocalText({ text: '/rootfs/bin and /root.d/x' }, { homeDir: '/root' })).toBe('/rootfs/bin and /root.d/x');
});

it('masks no path for a filesystem-root home, because that would erase every absolute path', () => {
  expect(redactLocalText({ text: '/usr/bin/node /etc/hosts' }, { homeDir: '/' })).toBe('/usr/bin/node /etc/hosts');
});

it('still redacts credentials alongside the home path', () => {
  const secret = ['ghp', '_', 'x'.repeat(36)].join('');
  const out = redactLocalText({ text: `${secret} /srv/svc/key.pem` }, { homeDir: '/srv/svc/' });
  expect(out).not.toContain(secret);
  expect(out.endsWith('~/key.pem')).toBe(true);
});

it('masks the current process home when no options are given', () => {
  vi.spyOn(os, 'homedir').mockReturnValue('/srv/hermetic-user');
  expect(redactLocalText({ text: '/srv/hermetic-user/private/gate.ts' })).toBe('~/private/gate.ts');
});

it('reads a Windows home with the win32 path flavour: the user directory is masked', () => {
  const out = redactLocalText({ text: String.raw`open C:\Users\ada\Sites\key.pem failed` }, { homeDir: String.raw`C:\Users\ada`, platformPath: path.win32 });
  expect(out).not.toContain('ada');
  expect(out).toContain(String.raw`\key.pem`);
});

it('treats a Windows drive-root home as a root: paths on that drive stay readable', () => {
  const text = String.raw`C:\Windows\System32\node.exe and C:\tools\x`;
  expect(redactLocalText({ text }, { homeDir: 'C:\\', platformPath: path.win32 })).toBe(text);
});
