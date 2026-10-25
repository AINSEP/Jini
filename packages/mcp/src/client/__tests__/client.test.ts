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

  describe('characterization pins (before refactor)', () => {
    it('emits refs in pattern order, then srcset candidates, keeping first-seen order on dedupe', () => {
      const html = '<img srcset="s1.png 1x, s2.png 2x"><img src="i.png"><script src="j.js"></script><link href="l.css"><div style="background:url(u.png)">';
      expect(extractRelativeRefs({ text: html, fromPath: 'index.html', fromMime: 'text/html' })).toEqual([
        'j.js', 'l.css', 'i.png', 'u.png', 's1.png', 's2.png',
      ]);
    });

    it('skips protocol-relative, mailto:, tel:, fragment-only and http refs case-insensitively', () => {
      const css = ['url(//cdn/x.png)', 'url(MAILTO:a@b)', 'url(tel:123)', 'url(#frag)', 'url(HTTP://x/y.png)', 'url(keep.png)'].join(' ');
      expect(extractRelativeRefs({ text: css, fromPath: 'a.css', fromMime: 'text/css' })).toEqual(['keep.png']);
    });

    it('strips query strings and fragments before normalizing', () => {
      const css = 'url(a.png?v=1) url(b.png#frag) url(c.png?x#y)';
      expect(extractRelativeRefs({ text: css, fromPath: 'd/s.css', fromMime: 'text/css' })).toEqual(['d/a.png', 'd/b.png', 'd/c.png']);
    });

    it('drops a ref that is only a query string or a bare root slash', () => {
      expect(extractRelativeRefs({ text: 'url(?v=1) url(/)', fromPath: 's.css', fromMime: 'text/css' })).toEqual([]);
    });

    it('drops a ref whose traversal escapes the root after first descending', () => {
      expect(extractRelativeRefs({ text: 'url(x/../../y.png) url(x/../z.png)', fromPath: 's.css', fromMime: 'text/css' })).toEqual(['z.png']);
    });

    it('collapses duplicate slashes and ./ segments in the resolved path', () => {
      expect(extractRelativeRefs({ text: 'url(a//./b.png)', fromPath: 'p/q/s.css', fromMime: 'text/css' })).toEqual(['p/q/a/b.png']);
    });

    it('ignores empty srcset parts', () => {
      expect(extractRelativeRefs({ text: '<img srcset=" , a.png 1x,,">', fromPath: 'i.html', fromMime: 'text/html' })).toEqual(['a.png']);
    });

    it('drops whitespace-only src and empty srcset parts from a nested file instead of resolving them to its directory', () => {
      expect(extractRelativeRefs({ text: '<img src="  "><img srcset=" , ">', fromPath: 'p/i.html', fromMime: 'text/html' })).toEqual([]);
    });

    it('runs CSS patterns when the mime is CSS even though the path is JS-like', () => {
      expect(extractRelativeRefs({ text: "url(c.png) import x from './m.js'", fromPath: 'a.js', fromMime: 'text/css' })).toEqual(['c.png', 'm.js']);
    });

    it('does not read srcset outside HTML-like files', () => {
      expect(extractRelativeRefs({ text: '<img srcset="a.png 1x">', fromPath: 'a.css', fromMime: 'text/css' })).toEqual([]);
    });

    it('runs JS patterns on a JS file that also matches another set (mime html, path .js)', () => {
      const text = "<img src=\"h.png\"> import x from './m.js'";
      expect(extractRelativeRefs({ text, fromPath: 'a.js', fromMime: 'text/html' })).toEqual(['h.png', 'm.js']);
    });

    it('treats backslash-separated parent segments as one literal segment (reported, not fixed)', () => {
      // Only "/" splits segments, so a Windows-style "..\\..\\x" survives the
      // root-escape check as a single literal segment; a consumer that hands this
      // to a Windows path API would resolve it as traversal.
      expect(extractRelativeRefs({ text: 'url(..\\..\\secret.txt)', fromPath: 's.css', fromMime: 'text/css' })).toEqual(['..\\..\\secret.txt']);
    });
  });
});

// Stryker L3 (2026-10-25): 54 Regex survivors in client.ts — only happy-path refs were tested.
// One row per pattern / anchor / file-kind decision, with negatives that must yield nothing.
describe('extractRelativeRefs — per-pattern table (F3)', () => {
  const refs = (text: string, fromPath: string, fromMime = '') => extractRelativeRefs({ text, fromPath, fromMime });
  it.each([
    ['html script src', '<script type="module" src="app.js"></script>', 'a/index.html', ['a/app.js']],
    ['html link href', "<link rel='stylesheet' href='s.css'>", 'index.html', ['s.css']],
    ['html img/source/video/audio/iframe', '<img src="i.png"><source src="s.webm"><video src="v.mp4"><audio src="a.mp3"><iframe src="f.html">', 'index.html',
      ['i.png', 's.webm', 'v.mp4', 'a.mp3', 'f.html']],
    ['srcset candidates', '<img srcset="a.png 1x, b.png 2x,c.png">', 'p/x.htm', ['p/a.png', 'p/b.png', 'p/c.png']],
    ['css url() unquoted and quoted', 'a{b:url( img/x.png )} c{d:url("y.png")}', 'css/s.css', ['css/img/x.png', 'css/y.png']],
    ['css @import string and url() (url() pattern runs first)', '@import "base.css"; @import url(\'theme.css\');', 's.css', ['theme.css', 'base.css']],
    ['js import / from / dynamic / require', "import a from './a.js'; export * from \"./b.js\"; import('./c.js'); require( './d.js' )", 'src/m.ts', ['src/a.js', 'src/b.js', 'src/c.js', 'src/d.js']],
    ['js-like by mime only', "import x from './x.js'", 'file', ['x.js'], 'application/javascript'],
    ['html-like by mime only', '<img src="i.png">', 'page', ['i.png'], 'text/html; charset=utf-8'],
    ['css-like by mime only', '@import "b.css";', 'sheet', ['b.css'], 'text/css'],
    ['prose is not JS', "the module imported from 'x' and from 'y'", 'notes.md', []],
    ['a .jsx.bak file is not JS', "import a from './a.js'", 'x.jsx.bak', []],
    ['an .mjs / .cjs / .tsx file is JS', "import a from './a.js'", 'x.cjs', ['a.js']],
    ['unknown text file runs only url()', '<img src="i.png"> url(k.png)', 'readme.txt', ['k.png']],
    ['html in a .html.bak is not HTML', '<img src="i.png">', 'x.html.bak', []],
    ['external refs dropped', '<img src="https://x/a.png"><img src="//cdn/a.png"><img src="data:x"><a><img src="mailto:a"><img src="tel:1"><img src="#top"><img src="HTTP://X/b.png">', 'index.html', []],
    ['root-absolute ref resolved from root', '<img src="/img/a.png">', 'deep/dir/index.html', ['img/a.png']],
    ['query and fragment stripped', '<img src="a.png?v=1#x">', 'index.html', ['a.png']],
    ['traversal within root kept, escape dropped', '<img src="../b.png"><img src="../../c.png">', 'd/index.html', ['b.png']],
    ['dot segments collapsed, duplicates removed', '<img src="./x/./a.png"><img src="x//a.png">', 'index.html', ['x/a.png']],
    ['empty refs ignored', '<img src=" ">', 'index.html', []],
  ])('%s', (_label, text, fromPath, expected, mime = '') => {
    expect(refs(text, fromPath, mime)).toEqual(expected);
  });

  it('empty text yields nothing', () => {
    expect(refs('', 'index.html')).toEqual([]);
  });
});

describe('isTextualMime — per-pattern table (F3)', () => {
  it.each([
    ['text/plain', true], ['TEXT/HTML', true], ['application/json', true], ['application/json; charset=utf-8', true],
    ['application/jsonl', false], ['application/javascript', true], ['application/typescript', true], ['application/xml', true],
    ['application/x-yaml', true], ['application/x-toml', true], ['application/x-httpd-php', true], ['application/x-sh', true],
    ['application/x-shellscript', false], ['application/ld+json', true], ['application/atom+xml', true], ['image/svg+xml', true],
    ['image/png', false], ['application/octet-stream', false], ['xtext/plain', false], ['', false], [undefined, false],
  ])('%s → %s', (mime, expected) => {
    expect(isTextualMime({ mime })).toBe(expected);
  });
});
