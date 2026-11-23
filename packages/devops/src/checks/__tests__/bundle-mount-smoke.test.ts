/**
 * Harness tests for the built-bundle mount smoke check. The DOM is a hand-built fake (no DOM
 * library dependency): `eval` runs a named script from a table, events are dispatched by hand, and
 * the settle wait is an injected port so no test sleeps for real.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test, vi, type Mock } from 'vitest';
import {
  BundleCheckError, checkBundleMounts, fail, isEntryPoint, isNavigationError, runBundleCheckCli, runBundleScenario,
  type BundleScenario, type BundleSmokeDom, type BundleSmokeWindow,
} from '../node.js';

const MOUNT_ID = 'app-root';
type Listener = (event: { error?: unknown; message?: unknown; reason?: unknown }) => void;

interface FakeElement { children: object[]; id: string; scrollIntoView?: (options?: unknown) => void }
interface FakeWindow extends BundleSmokeWindow {
  listeners: Map<string, Listener[]>;
  dispatch(type: string, event: Parameters<Listener>[0]): void;
  mount: FakeElement | null;
  sessionStorage: Map<string, string>;
}

/** A fake window whose `eval` runs `scripts[source]`; unknown sources do nothing. */
function fakeDom(scripts: Record<string, (window: FakeWindow) => void>, { html = '', url = '' } = {}) {
  const listeners = new Map<string, Listener[]>();
  const consoleErrorListeners: Array<(error: unknown) => void> = [];
  class Element {}
  const window: FakeWindow = {
    listeners,
    dispatch: (type, event) => { for (const listener of listeners.get(type) ?? []) listener(event); },
    mount: { id: MOUNT_ID, children: [] },
    sessionStorage: new Map(),
    Element: Element as unknown as BundleSmokeWindow['Element'],
    setTimeout: (callback: () => void) => { callback(); return 0; },
    addEventListener: (type, listener) => { listeners.set(type, [...(listeners.get(type) ?? []), listener as Listener]); },
    document: { getElementById: (id: string) => (id === window.mount?.id ? window.mount : null) },
    eval: (source: string) => scripts[source]?.(window),
  };
  const dispose: Mock<() => void> = vi.fn();
  const dom: BundleSmokeDom<FakeWindow> & { dispose: Mock<() => void>; html: string; url: string; consoleError(error: unknown): void } = {
    window, dispose, html, url,
    onConsoleError: (listener) => { consoleErrorListeners.push(listener); },
    consoleError: (error) => { for (const listener of consoleErrorListeners) listener(error); },
  };
  return dom;
}

const mounts = (window: FakeWindow) => { window.mount!.children.push({}); };

/** Ports for one scenario run: a fresh fake DOM per `createDom` call, recorded for inspection. */
function harness(scripts: Record<string, (window: FakeWindow) => void>, { onWait }: { onWait?: (dom: ReturnType<typeof fakeDom>) => void } = {}) {
  const doms: Array<ReturnType<typeof fakeDom>> = [];
  const lines: string[] = [];
  const createDom = vi.fn(({ html, url }: { html: string; url: string }) => {
    const dom = fakeDom(scripts, { html, url });
    doms.push(dom);
    return dom;
  });
  const wait = vi.fn(async ({ ms }: { ms: number }) => { void ms; onWait?.(doms.at(-1)!); });
  const required = { createDom, mountId: MOUNT_ID, pageHtml: '<article>page</article>', url: 'http://localhost/page' };
  const options = { wait, log: (line: string) => void lines.push(line) };
  return { doms, lines, createDom, wait, required, options };
}

test('fail throws a BundleCheckError carrying the message', () => {
  expect(() => fail({ message: 'nope' })).toThrow(BundleCheckError);
  expect(() => fail({ message: 'nope' })).toThrow(/^nope$/);
});

test('isNavigationError recognises only a navigation report', () => {
  expect(isNavigationError({ error: new Error('Not implemented: navigation (except hash changes)') })).toBe(true);
  expect(isNavigationError({ error: new Error('Not implemented: window.alert') })).toBe(false);
  expect(isNavigationError({ error: { message: 42 } })).toBe(false);
  expect(isNavigationError({ error: null })).toBe(false);
});

test('a mounting bundle passes in a fresh DOM built from the mount id, page HTML and url, with the browser gaps stubbed', async () => {
  const seen: unknown[] = [];
  const h = harness({
    bundle: (window) => {
      mounts(window);
      const element = new (window.Element as unknown as new () => FakeElement)();
      element.scrollIntoView!({ block: 'center' });
      element.scrollIntoView!({ block: 'start' });
      seen.push((element as unknown as Record<string, unknown>).__jiniScrollIntoViewCalls, (element as unknown as Record<string, unknown>).__jiniLastScrollIntoViewOptions);
      const media = window.matchMedia!('(prefers-reduced-motion: reduce)');
      media.addEventListener('change', () => {});
      media.removeEventListener('change', () => {});
      seen.push(media.matches, media.media);
      window.requestAnimationFrame!((time) => { seen.push(typeof time); });
    },
  });
  const scenario: BundleScenario<FakeWindow> = {
    name: 'exerciser',
    seed: ({ storage }) => { storage.set('seeded', 'yes'); },
    verify: ({ storage, document, navigationAttempts }) => { seen.push(storage.get('seeded'), document.getElementById(MOUNT_ID) !== null, navigationAttempts); },
  };
  await runBundleScenario({ ...h.required, scenario, bundleSource: 'bundle' }, h.options);
  expect(h.createDom).toHaveBeenCalledTimes(1);
  expect(h.doms[0]!.html).toBe('<!doctype html><html><body><div id="app-root"></div><article>page</article></body></html>');
  expect(h.doms[0]!.url).toBe('http://localhost/page');
  expect(h.wait).toHaveBeenCalledWith({ ms: 150 });
  expect(seen).toEqual([2, { block: 'start' }, false, '(prefers-reduced-motion: reduce)', 'number', 'yes', true, []]);
  expect(h.lines).toEqual(['[bundle-mount-smoke] OK [exerciser] — bundle executed cleanly and mounted 1 child element(s) into #app-root.']);
});

test('navigation reports from the DOM are collected for verify; other console errors are not', async () => {
  const h = harness({ bundle: mounts }, {
    onWait: (dom) => {
      dom.consoleError(new Error('Not implemented: navigation (except hash changes)'));
      dom.consoleError(new Error('Not implemented: window.alert'));
    },
  });
  const attempts: string[][] = [];
  await runBundleScenario({ ...h.required, scenario: { name: 'nav', verify: ({ navigationAttempts }) => { attempts.push([...navigationAttempts]); } }, bundleSource: 'bundle' },
    { ...h.options, settleMs: 7, label: 'host-check' });
  expect(attempts).toEqual([['Not implemented: navigation (except hash changes)']]);
  expect(h.wait).toHaveBeenCalledWith({ ms: 7 });
  expect(h.lines[0]).toMatch(/^\[host-check\] OK \[nav\]/);
});

test('a throw while evaluating fails before the mount check', async () => {
  const h = harness({ crash: () => { throw new Error('process is not defined'); } });
  const run = runBundleScenario({ ...h.required, scenario: { name: 'sync' }, bundleSource: 'crash' }, h.options);
  await expect(run).rejects.toThrow(BundleCheckError);
  await expect(run).rejects.toThrow(/^\[sync\] the bundle threw during execution — it would have crashed on load in a real browser:\n {2}- Error: process is not defined/);
  expect(h.wait).not.toHaveBeenCalled();
});

test('error and unhandled-rejection events raised during evaluation are listed, with a missing error falling back to the message', async () => {
  const h = harness({
    events: (window) => {
      mounts(window);
      window.dispatch('error', { error: new Error('render crashed') });
      window.dispatch('error', { message: 'plain message' });
      window.dispatch('unhandledrejection', { reason: null });
    },
  });
  const run = runBundleScenario({ ...h.required, scenario: { name: 'events' }, bundleSource: 'events' }, h.options);
  await expect(run).rejects.toThrow(/render crashed[\s\S]*\n {2}- plain message\n {2}- null$/);
});

test('an error after evaluation is a post-mount failure', async () => {
  const h = harness({ bundle: mounts }, { onWait: (dom) => dom.window.dispatch('error', { message: 'effect failed' }) });
  const verify = vi.fn();
  const run = runBundleScenario({ ...h.required, scenario: { name: 'late', verify }, bundleSource: 'bundle' }, h.options);
  await expect(run).rejects.toThrow(/^\[late\] the bundle threw after mounting \(a post-mount effect or async error\):\n {2}- effect failed$/);
  expect(verify).not.toHaveBeenCalled();
});

test('a removed or empty mount point fails', async () => {
  const h = harness({ remove: (window) => { window.mount = null; } });
  await expect(runBundleScenario({ ...h.required, scenario: { name: 'gone' }, bundleSource: 'remove' }, h.options))
    .rejects.toThrow(/^\[gone\] #app-root is missing from the DOM after evaluating the bundle$/);
  await expect(runBundleScenario({ ...h.required, scenario: { name: 'empty' }, bundleSource: 'nothing' }, h.options))
    .rejects.toThrow(/^\[empty\] #app-root has no children after evaluating the bundle — nothing mounted into it$/);
});

test('each scenario gets a fresh DOM that is disposed exactly once on every exit path', async () => {
  const late = (dom: ReturnType<typeof fakeDom>) => { if (dom.url.endsWith('#late')) dom.window.dispatch('error', { message: 'late' }); };
  const h = harness({ ok: mounts, crash: () => { throw new Error('boom'); }, late: mounts }, { onWait: late });
  const run = (bundleSource: string, extra: Partial<BundleScenario<FakeWindow>> = {}, url = h.required.url) =>
    runBundleScenario({ ...h.required, url, scenario: { name: bundleSource, ...extra }, bundleSource }, h.options).catch((error: unknown) => error);
  expect(await run('ok')).toBeUndefined();
  expect(await run('crash')).toBeInstanceOf(BundleCheckError);
  expect(await run('late', {}, 'http://localhost/page#late')).toBeInstanceOf(BundleCheckError);
  expect(await run('nothing')).toBeInstanceOf(BundleCheckError);
  expect(await run('ok', { verify: () => fail({ message: 'verify refused' }) })).toBeInstanceOf(BundleCheckError);
  const seedBug = new TypeError('seed bug');
  expect(await run('ok', { seed: () => { throw seedBug; } })).toBe(seedBug);
  expect(h.doms).toHaveLength(6);
  expect(new Set(h.doms.map((dom) => dom.window)).size).toBe(6);
  expect(h.doms.map((dom) => dom.dispose.mock.calls.length)).toEqual([1, 1, 1, 1, 1, 1]);
});

test('scenarios run in order and stop at the first failure', async () => {
  const h = harness({ bundle: mounts });
  const order: string[] = [];
  const scenarios: Array<BundleScenario<FakeWindow>> = [
    { name: 'first', verify: () => { order.push('first'); } },
    { name: 'second', verify: () => { order.push('second'); fail({ message: 'second refused' }); } },
    { name: 'third', verify: () => { order.push('third'); } },
  ];
  await expect(checkBundleMounts({ ...h.required, scenarios, bundleSource: 'bundle' }, h.options)).rejects.toThrow(/^second refused$/);
  expect(order).toEqual(['first', 'second']);
  expect(h.createDom).toHaveBeenCalledTimes(2);
  expect(h.lines).toHaveLength(1);
});

test('the CLI reads the bundle, runs the check and reports success as 0', async () => {
  const check = vi.fn(async () => {});
  const error = vi.fn();
  const exit = vi.fn();
  const status = await runBundleCheckCli({ bundlePath: '/dist/a.js', readText: () => 'bundle text', check, error, exit });
  expect(status).toBe(0);
  expect(check).toHaveBeenCalledWith({ bundleSource: 'bundle text' });
  expect(error).not.toHaveBeenCalled();
  expect(exit).not.toHaveBeenCalled();
});

test('the CLI reports an unreadable bundle with exit 1', async () => {
  const errors: string[] = [];
  const exits: number[] = [];
  const ports = { error: (line: string) => void errors.push(line), exit: (code: number) => void exits.push(code) };
  const check = vi.fn(async () => {});
  const status = await runBundleCheckCli({ ...ports, bundlePath: '/dist/a.js', readText: () => { throw new Error('ENOENT'); }, check }, { label: 'host-check' });
  expect(status).toBe(1);
  expect(check).not.toHaveBeenCalled();
  expect(errors).toEqual(['[host-check] FAIL: could not read /dist/a.js — did the build run first? (ENOENT)']);
  expect(exits).toEqual([1]);
});

test('the CLI reports a failed scenario with exit 1 and rethrows anything that is not a check failure', async () => {
  const errors: string[] = [];
  const exits: number[] = [];
  const ports = { error: (line: string) => void errors.push(line), exit: (code: number) => void exits.push(code), bundlePath: '/b.js', readText: () => '' };
  expect(await runBundleCheckCli({ ...ports, check: async () => fail({ message: '[x] broke' }) })).toBe(1);
  expect(errors).toEqual(['[bundle-mount-smoke] FAIL: [x] broke']);
  await expect(runBundleCheckCli({ ...ports, check: async () => { throw new TypeError('a bug, not a check failure'); } })).rejects.toThrow(TypeError);
  expect(errors).toHaveLength(1);
  expect(exits).toEqual([1]);
});

test('isEntryPoint is true only for the started script', () => {
  const file = path.resolve('scripts/check.mjs');
  expect(isEntryPoint({ moduleUrl: pathToFileURL(file).href, argv1: file })).toBe(true);
  expect(isEntryPoint({ moduleUrl: pathToFileURL(file).href, argv1: 'scripts/check.mjs' })).toBe(true);
  expect(isEntryPoint({ moduleUrl: pathToFileURL(file).href, argv1: '/somewhere/else.mjs' })).toBe(false);
  expect(isEntryPoint({ moduleUrl: pathToFileURL(file).href, argv1: undefined })).toBe(false);
});
