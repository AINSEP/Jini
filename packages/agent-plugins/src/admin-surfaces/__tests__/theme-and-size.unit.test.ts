/**
 * @file Unit tests for the host's design tokens and the frame's height, both ways across the frame:
 * `theme.ts` (what the host reads and sends), the client applying a theme (only from its own host, only
 * safe names and values, dropping tokens a later theme leaves out), the client reporting its height,
 * and `readAdminSurfaceResize` (the host accepting only its own mount's height, clamped).
 * The parent window, listener, theme root and size source are typed fakes.
 */
import { describe, expect, test } from 'vitest';
import {
  ADMIN_SURFACE_MAX_HEIGHT, ADMIN_SURFACE_MIN_HEIGHT, readAdminSurfaceResize,
} from '../host-validator.js';
import {
  createAdminSurfaceClient, type AdminSurfaceIncomingMessage, type AdminSurfaceParentPort, type AdminSurfaceThemeRoot,
} from '../surface-client.js';
import { adminSurfaceThemeMessage, isSafeAdminSurfaceThemeValue, readAdminSurfaceTheme } from '../theme.js';

const HOST = 'https://host.example.com';
const BASE = { protocol: 'jini.admin-surface', version: 1 } as const;

function fakeRoot() {
  const properties = new Map<string, string>();
  const attributes = new Map<string, string>();
  const root: AdminSurfaceThemeRoot = {
    style: { setProperty: (name, value) => { properties.set(name, value); }, removeProperty: (name) => { properties.delete(name); } },
    setAttribute: (name, value) => { attributes.set(name, value); },
  };
  return { root, properties, attributes };
}

function harness() {
  const posted: Array<{ message: unknown; targetOrigin: string }> = [];
  const parent: AdminSurfaceParentPort = { postMessage: (message, targetOrigin) => { posted.push({ message, targetOrigin }); } };
  let deliver: (event: AdminSurfaceIncomingMessage) => void = () => undefined;
  let reportHeight: (height: number) => void = () => undefined;
  let sizeStopped = false;
  const theme = fakeRoot();
  const client = createAdminSurfaceClient(
    { parent, listen: (handler) => { deliver = handler; return () => { deliver = () => undefined; }; } },
    { themeRoot: theme.root, size: (onHeight) => { reportHeight = onHeight; return () => { sizeStopped = true; }; } },
  );
  const send = (data: unknown, from: Partial<AdminSurfaceIncomingMessage> = {}) => deliver({ origin: HOST, source: parent, data, ...from });
  const init = (data: Record<string, unknown> = {}) => send({ ...BASE, kind: 'init', mountId: 'm-1', ...data });
  const themeMessage = (theme: unknown, mountId = 'm-1') => send({ ...BASE, kind: 'theme', mountId, theme });
  return { posted, client, send, init, themeMessage, theme, height: (value: number) => reportHeight(value), sizeStopped: () => sizeStopped };
}

describe('theme.ts', () => {
  test('reads each token from the host name it maps to, trimmed, and drops empty or unsafe values', () => {
    const values: Record<string, string> = { '--primary': ' #b5532a ', '--fg': 'url(https://evil.example/x)', '--jini-radius': '6px', '--bg': '' };
    const theme = readAdminSurfaceTheme(
      { style: { getPropertyValue: (name) => values[name] ?? '' }, scheme: 'dark' },
      { sources: { '--jini-primary': '--primary', '--jini-text': '--fg', '--jini-bg': '--bg' } },
    );
    expect(theme).toEqual({ scheme: 'dark', tokens: { '--jini-primary': '#b5532a', '--jini-radius': '6px' } });
  });

  test('a safe value is plain declaration text: no fetches, no declaration breakouts, at most 200 characters', () => {
    expect(isSafeAdminSurfaceThemeValue('color-mix(in oklab, #fff 80%, #000)')).toBe(true);
    for (const unsafe of ['image-set("a.png" 1x)', 'red; background: blue', 'a{b}', '<x>', 'a\\62', '@import', 'x'.repeat(201), '', 42]) {
      expect(isSafeAdminSurfaceThemeValue(unsafe)).toBe(false);
    }
  });

  test('the theme message is addressed to one mount', () => {
    const theme = { scheme: 'light' as const, tokens: { '--jini-bg': '#fff' } };
    expect(adminSurfaceThemeMessage({ mountId: 'm-9', theme })).toEqual({ ...BASE, kind: 'theme', mountId: 'm-9', theme });
  });
});

describe('client theme', () => {
  test('init applies the tokens, the colour scheme and the scheme attribute, and theme() returns them', () => {
    const { client, init, theme } = harness();
    init({ theme: { scheme: 'dark', tokens: { '--jini-primary': '#b5532a' } } });
    expect(Object.fromEntries(theme.properties)).toEqual({ '--jini-primary': '#b5532a', 'color-scheme': 'dark' });
    expect(theme.attributes.get('data-jini-scheme')).toBe('dark');
    expect(client.theme()).toEqual({ scheme: 'dark', tokens: { '--jini-primary': '#b5532a' } });
  });

  test('names outside --jini-* and unsafe values are dropped; a theme with no valid scheme is ignored', () => {
    const { client, init, themeMessage, theme } = harness();
    init({ theme: { scheme: 'light', tokens: { '--jini-bg': '#fff', color: 'red', '--jini-text': 'url(x)', '--jini-link': 'a;b' } } });
    expect(Object.fromEntries(theme.properties)).toEqual({ '--jini-bg': '#fff', 'color-scheme': 'light' });
    themeMessage({ scheme: 'sepia', tokens: { '--jini-bg': '#000' } });
    expect(client.theme()).toEqual({ scheme: 'light', tokens: { '--jini-bg': '#fff' } });
  });

  test('a later theme replaces the tokens and removes the ones it no longer sends', () => {
    const { init, themeMessage, theme } = harness();
    init({ theme: { scheme: 'light', tokens: { '--jini-bg': '#fff', '--jini-text': '#111' } } });
    themeMessage({ scheme: 'dark', tokens: { '--jini-bg': '#000' } });
    expect(Object.fromEntries(theme.properties)).toEqual({ '--jini-bg': '#000', 'color-scheme': 'dark' });
  });

  test('a theme from another origin, another window, another mount, or before init changes nothing', () => {
    const { client, init, themeMessage, send, theme } = harness();
    themeMessage({ scheme: 'dark', tokens: { '--jini-bg': '#000' } });
    expect(theme.properties.size).toBe(0);
    init({ theme: { scheme: 'light', tokens: { '--jini-bg': '#fff' } } });
    const dark = { ...BASE, kind: 'theme', mountId: 'm-1', theme: { scheme: 'dark', tokens: { '--jini-bg': '#000' } } };
    send(dark, { origin: 'https://other.example.com' });
    send(dark, { source: {} });
    themeMessage({ scheme: 'dark', tokens: { '--jini-bg': '#000' } }, 'm-2');
    expect(client.theme()).toEqual({ scheme: 'light', tokens: { '--jini-bg': '#fff' } });
  });
});

describe('client height', () => {
  test('nothing is reported before init; after it, each new height goes to the host origin once', () => {
    const { posted, init, height } = harness();
    height(300);
    expect(posted).toEqual([]);
    init();
    height(300);
    height(300);
    height(Number.NaN);
    height(420);
    expect(posted).toEqual([
      { message: { ...BASE, kind: 'resize', mountId: 'm-1', height: 300 }, targetOrigin: HOST },
      { message: { ...BASE, kind: 'resize', mountId: 'm-1', height: 420 }, targetOrigin: HOST },
    ]);
  });

  test('close stops the size source', () => {
    const { client, init, sizeStopped } = harness();
    init();
    client.close();
    expect(sizeStopped()).toBe(true);
  });
});

describe('readAdminSurfaceResize', () => {
  const frame = {};
  const mount = { mountId: 'm-1', frame };
  const event = (data: unknown, overrides: Record<string, unknown> = {}) => ({ origin: 'null', source: frame, data, ...overrides });
  const resize = (height: unknown, mountId = 'm-1') => ({ ...BASE, kind: 'resize', mountId, height });

  test("returns this mount's height, rounded up and clamped to the host's range", () => {
    expect(readAdminSurfaceResize({ event: event(resize(311.2)), mount })).toBe(312);
    expect(readAdminSurfaceResize({ event: event(resize(5)), mount })).toBe(ADMIN_SURFACE_MIN_HEIGHT);
    expect(readAdminSurfaceResize({ event: event(resize(1e9)), mount })).toBe(ADMIN_SURFACE_MAX_HEIGHT);
    expect(readAdminSurfaceResize({ event: event(resize(900)), mount }, { max: 600 })).toBe(600);
  });

  test('anything else is null: wrong origin, window, mount, kind, or a height that is not a finite number', () => {
    expect(readAdminSurfaceResize({ event: event(resize(300), { origin: HOST }), mount })).toBeNull();
    expect(readAdminSurfaceResize({ event: event(resize(300), { source: {} }), mount })).toBeNull();
    expect(readAdminSurfaceResize({ event: event(resize(300, 'm-2')), mount })).toBeNull();
    expect(readAdminSurfaceResize({ event: event({ ...resize(300), kind: 'action-request' }), mount })).toBeNull();
    expect(readAdminSurfaceResize({ event: event(resize('300')), mount })).toBeNull();
    expect(readAdminSurfaceResize({ event: event(resize(Number.POSITIVE_INFINITY)), mount })).toBeNull();
    expect(readAdminSurfaceResize({ event: event(null), mount })).toBeNull();
  });
});
