import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMcpIdleExitController, extractRelativeRefs, isTextualMime } from '../client.js';

describe('createMcpIdleExitController', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires onIdle once after the idle window elapses', () => {
    vi.useFakeTimers();
    const onIdle = vi.fn();
    const c = createMcpIdleExitController({ idleMs: 1000, onIdle });
    vi.advanceTimersByTime(999);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onIdle).toHaveBeenCalledTimes(1);
    c.dispose({});
  });

  it('noteActivity resets the idle timer', () => {
    vi.useFakeTimers();
    const onIdle = vi.fn();
    const c = createMcpIdleExitController({ idleMs: 1000, onIdle });
    vi.advanceTimersByTime(600);
    c.noteActivity({});
    vi.advanceTimersByTime(600);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(onIdle).toHaveBeenCalledTimes(1);
    c.dispose({});
  });

  it('defers idle while a request is in flight, then re-arms once it settles', async () => {
    vi.useFakeTimers();
    const onIdle = vi.fn();
    const c = createMcpIdleExitController({ idleMs: 1000, onIdle });
    let resolveFn!: (v: string) => void;
    const p = c.trackRequest({ fn: () => new Promise<string>((r) => { resolveFn = r; }) });
    // Timer fires while the request is still in flight -> re-schedule, no idle.
    vi.advanceTimersByTime(1000);
    expect(onIdle).not.toHaveBeenCalled();
    resolveFn('done');
    await expect(p).resolves.toBe('done');
    // Now idle again from a clean re-arm.
    vi.advanceTimersByTime(1000);
    expect(onIdle).toHaveBeenCalledTimes(1);
    c.dispose({});
  });

  it('does not re-arm while other requests remain in flight', async () => {
    vi.useFakeTimers();
    const onIdle = vi.fn();
    const c = createMcpIdleExitController({ idleMs: 1000, onIdle });
    let r1!: (v: string) => void;
    let r2!: (v: string) => void;
    const p1 = c.trackRequest({ fn: () => new Promise<string>((r) => { r1 = r; }) });
    const p2 = c.trackRequest({ fn: () => new Promise<string>((r) => { r2 = r; }) });
    r1('a');
    await expect(p1).resolves.toBe('a');
    // One request still in flight, so no idle should be scheduled/fire yet.
    vi.advanceTimersByTime(1000);
    expect(onIdle).not.toHaveBeenCalled();
    r2('b');
    await expect(p2).resolves.toBe('b');
    c.dispose({});
  });

  it('after dispose, trackRequest runs directly, noteActivity is a no-op, and re-dispose is safe', async () => {
    vi.useFakeTimers();
    const onIdle = vi.fn();
    const c = createMcpIdleExitController({ idleMs: 1000, onIdle });
    c.dispose({});
    await expect(c.trackRequest({ fn: () => 'direct' })).resolves.toBe('direct');
    c.noteActivity({});
    c.dispose({});
    vi.advanceTimersByTime(5000);
    expect(onIdle).not.toHaveBeenCalled();
  });

  describe('idleMs validation (SEC-RB-011)', () => {
    it.each([-1, 0, NaN, Infinity, -Infinity, 1.5, 0.5])(
      'rejects an invalid idleMs (%p)',
      (bad) => {
        expect(() => createMcpIdleExitController({ idleMs: bad, onIdle: () => {} })).toThrow(RangeError);
      },
    );

    it('rejects a non-number idleMs', () => {
      expect(() =>
        createMcpIdleExitController({ idleMs: 'nope' as unknown as number, onIdle: () => {} }),
      ).toThrow(RangeError);
      expect(() =>
        createMcpIdleExitController({ idleMs: null as unknown as number, onIdle: () => {} }),
      ).toThrow(RangeError);
    });

    it('accepts the minimum valid idleMs (1ms)', () => {
      vi.useFakeTimers();
      const onIdle = vi.fn();
      const c = createMcpIdleExitController({ idleMs: 1, onIdle });
      vi.advanceTimersByTime(1);
      expect(onIdle).toHaveBeenCalledTimes(1);
      c.dispose({});
    });

    it('clamps an excessively large idleMs to the 24h ceiling instead of scheduling an effectively-infinite timer', () => {
      vi.useFakeTimers();
      const onIdle = vi.fn();
      const c = createMcpIdleExitController({ idleMs: Number.MAX_SAFE_INTEGER, onIdle });
      vi.advanceTimersByTime(24 * 60 * 60 * 1000);
      expect(onIdle).toHaveBeenCalledTimes(1);
      c.dispose({});
    });
  });

  describe('trackRequest does not needlessly reschedule the idle timer (SEC-RB-011)', () => {
    it('does not call setTimeout when a request starts; only completion reschedules', async () => {
      vi.useFakeTimers();
      const onIdle = vi.fn();
      const c = createMcpIdleExitController({ idleMs: 1000, onIdle });
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
      setTimeoutSpy.mockClear();
      let resolveFn!: (v: string) => void;
      const p = c.trackRequest({ fn: () => new Promise<string>((r) => { resolveFn = r; }) });
      expect(setTimeoutSpy).not.toHaveBeenCalled();
      resolveFn('done');
      await expect(p).resolves.toBe('done');
      expect(setTimeoutSpy).toHaveBeenCalledTimes(1); // only the completion-triggered reschedule
      c.dispose({});
    });

    it('still defers idle correctly while in flight even without the start-of-request reschedule', () => {
      vi.useFakeTimers();
      const onIdle = vi.fn();
      const c = createMcpIdleExitController({ idleMs: 1000, onIdle });
      let resolveFn!: (v: string) => void;
      void c.trackRequest({ fn: () => new Promise<string>((r) => { resolveFn = r; }) });
      vi.advanceTimersByTime(1000);
      expect(onIdle).not.toHaveBeenCalled(); // deferred: inFlight > 0 re-arms on fire
      resolveFn('done');
      c.dispose({});
    });
  });
});

describe('isTextualMime', () => {
  it('classifies textual mimes across the pattern set', () => {
    for (const mime of [
      'text/html',
      'text/css',
      'application/json',
      'application/javascript',
      'application/typescript',
      'application/xml',
      'application/x-yaml',
      'application/vnd.api+json',
      'application/xhtml+xml',
      'image/svg+xml',
    ]) {
      expect(isTextualMime({ mime })).toBe(true);
    }
  });

  it('rejects binary and absent mimes', () => {
    expect(isTextualMime({ mime: 'application/octet-stream' })).toBe(false);
    expect(isTextualMime({ mime: 'image/png' })).toBe(false);
    expect(isTextualMime({ mime: undefined })).toBe(false);
  });
});

describe('extractRelativeRefs', () => {
  it('returns [] for empty text', () => {
    expect(extractRelativeRefs({ text: '', fromPath: 'index.html', fromMime: 'text/html' })).toEqual([]);
  });

  it('extracts HTML/CSS refs, resolves against a nested dir, and dedupes', () => {
    const html = [
      '<script src="app.js"></script>',
      '<link href="styles/site.css">',
      '<img src="/img/logo.png">',
      '<img srcset="a.png 1x, b.png 2x, ">',
      '<source src="v.mp4">',
      '<video src="v2.mp4">',
      '<audio src="a.mp3">',
      '<iframe src="frame.html">',
      '<a href="https://cdn.example.com/x.js">',
      '<img src="data:image/png;base64,xxx">',
      '<img src="   ">',
      '<script src="./dup.js"></script>',
      '<script src="dup.js"></script>',
    ].join('\n');
    const refs = extractRelativeRefs({ text: html, fromPath: 'pages/index.html', fromMime: 'text/html' });
    expect(refs).toContain('pages/app.js');
    expect(refs).toContain('pages/styles/site.css');
    expect(refs).toContain('img/logo.png'); // rooted "/img/logo.png"
    expect(refs).toContain('pages/a.png');
    expect(refs).toContain('pages/b.png');
    expect(refs).toContain('pages/v.mp4');
    expect(refs).toContain('pages/frame.html');
    expect(refs).toContain('pages/dup.js');
    // skipped: cdn, data:, whitespace-only
    expect(refs).not.toContain('https://cdn.example.com/x.js');
    // deduped
    expect(refs.filter((r) => r === 'pages/dup.js')).toHaveLength(1);
  });

  it('handles CSS url()/@import, parent traversal, root-rooted refs, and dot-only refs', () => {
    const css = [
      '@import url("base.css");',
      ".a { background: url('img/bg.png'); }",
      '.b { background: url(../shared/x.png); }',
      '.c { background: url(/root.png); }',
      '.d { background: url(../../escape.png); }',
      '.e { background: url(.); }',
    ].join('\n');
    const refs = extractRelativeRefs({ text: css, fromPath: 'styles/main.css', fromMime: 'text/css' });
    expect(refs).toContain('styles/base.css');
    expect(refs).toContain('styles/img/bg.png');
    expect(refs).toContain('shared/x.png'); // ../shared/x.png from styles/
    expect(refs).toContain('root.png'); // /root.png
    expect(refs).not.toContain('escape.png'); // ../../ escapes the root
  });

  it('extracts JS/TS import/require/dynamic-import specifiers', () => {
    const js = [
      "import a from './a.js';",
      'import { b } from "b/mod.js";',
      "const c = require('./c.js');",
      'const d = await import("d.js");',
      "export { x } from './x.js';",
      "import 'https://cdn/y.js';",
    ].join('\n');
    const refs = extractRelativeRefs({ text: js, fromPath: 'src/index.js', fromMime: 'application/javascript' });
    expect(refs).toEqual(expect.arrayContaining(['src/a.js', 'src/b/mod.js', 'src/c.js', 'src/d.js', 'src/x.js']));
    expect(refs).not.toContain('https://cdn/y.js');
  });

  it('falls back to url() extraction for unknown textual types and a root-level file (empty dir)', () => {
    const refs = extractRelativeRefs({ text: 'body { background: url(only.css) }', fromPath: 'notes.txt', fromMime: 'text/plain' });
    expect(refs).toEqual(['only.css']);
  });

  it('selects pattern sets by extension when the mime is blank', () => {
    expect(extractRelativeRefs({ text: '<img src="a.png">', fromPath: 'page.htm', fromMime: '' })).toEqual(['a.png']);
    expect(extractRelativeRefs({ text: '.a{background:url(a.png)}', fromPath: 'a.css', fromMime: '' })).toEqual(['a.png']);
    expect(extractRelativeRefs({ text: "import x from './m.tsx'", fromPath: 'a.tsx', fromMime: '' })).toEqual(['m.tsx']);
  });

  it('recognizes typescript mime as JS-like', () => {
    expect(extractRelativeRefs({ text: "import x from './m.ts'", fromPath: 'a.unknownext', fromMime: 'application/typescript' })).toEqual(['m.ts']);
  });
});
