import { describe, expect, it } from 'vitest';
import { decideAutoOpenAfterWrite, selectAutoOpenProducedArtifact } from '../auto-open-file.js';

describe('decideAutoOpenAfterWrite', () => {
  const files = [
    { name: 'App.jsx', path: 'src/App.jsx' },
    { name: 'index.html', path: 'index.html' },
  ];

  it('opens on an exact path match', () => {
    expect(decideAutoOpenAfterWrite('src/App.jsx', files)).toEqual({
      shouldOpen: true,
      fileName: 'App.jsx',
    });
  });

  it('opens on a full-segment suffix match', () => {
    expect(decideAutoOpenAfterWrite('/abs/project/src/App.jsx', files)).toEqual({
      shouldOpen: true,
      fileName: 'App.jsx',
    });
  });

  it('declines a partial-segment suffix match (notsubdir vs subdir)', () => {
    const withSubdir = [{ name: 'App.jsx', path: 'subdir/App.jsx' }];
    expect(decideAutoOpenAfterWrite('/abs/notsubdir/App.jsx', withSubdir)).toEqual({
      shouldOpen: false,
      fileName: null,
    });
  });

  it('declines when multiple files share a path suffix', () => {
    // Both an exact match and a shorter suffix match resolve against the
    // same filePath — genuinely ambiguous, so neither should win.
    const ambiguous = [
      { name: 'a', path: 'a/b/App.jsx' },
      { name: 'b', path: 'b/App.jsx' },
    ];
    expect(decideAutoOpenAfterWrite('a/b/App.jsx', ambiguous).shouldOpen).toBe(false);
  });

  it('falls back to a unique basename match when filePath has no slash', () => {
    expect(decideAutoOpenAfterWrite('index.html', files)).toEqual({
      shouldOpen: true,
      fileName: 'index.html',
    });
  });

  it('declines a basename-only match when filePath has a slash but no suffix match', () => {
    expect(decideAutoOpenAfterWrite('/some/external/App.jsx', files).shouldOpen).toBe(false);
  });

  it('declines an empty filePath', () => {
    expect(decideAutoOpenAfterWrite('', files)).toEqual({ shouldOpen: false, fileName: null });
  });

  it('declines a resolved candidate that is a module file', () => {
    expect(
      decideAutoOpenAfterWrite('src/App.jsx', files, { moduleFileNames: new Set(['App.jsx']) }),
    ).toEqual({ shouldOpen: false, fileName: null });
  });

  it('reaches the basename fallback when filePath is a bare basename that is not itself a full rel path', () => {
    // 'App.jsx' has no slash, doesn't equal 'src/App.jsx' exactly, and is
    // shorter than it (so the suffix check can't match either) — the only
    // path that actually resolves this is the basename fallback.
    expect(decideAutoOpenAfterWrite('App.jsx', files)).toEqual({
      shouldOpen: true,
      fileName: 'App.jsx',
    });
  });

  it('declines a basename fallback with more than one match', () => {
    const dup = [
      { name: 'a', path: 'src/App.jsx' },
      { name: 'b', path: 'lib/App.jsx' },
    ];
    expect(decideAutoOpenAfterWrite('App.jsx', dup)).toEqual({ shouldOpen: false, fileName: null });
  });

  it('resolves a candidate using name instead of path when path is absent', () => {
    const nameOnly = [{ name: 'App.jsx' }];
    expect(decideAutoOpenAfterWrite('App.jsx', nameOnly)).toEqual({
      shouldOpen: true,
      fileName: 'App.jsx',
    });
  });

  it('skips a candidate whose path and name are both falsy', () => {
    const blank = [{ name: '', path: '' }, { name: 'App.jsx', path: 'src/App.jsx' }];
    expect(decideAutoOpenAfterWrite('src/App.jsx', blank)).toEqual({
      shouldOpen: true,
      fileName: 'App.jsx',
    });
  });

  it('the basename fallback filter itself resolves rel via name when path is absent, and skips a blank rel', () => {
    // Neither candidate matches filePath at all (by exact, suffix, or
    // basename) — this exercises the basename-fallback filter's own
    // `f.path ?? f.name` and `rel ? ... : false` branches directly, distinct
    // from the identical-looking expression in the earlier suffix-match
    // loop (a name-only candidate that DOES match always resolves in the
    // suffix loop first, so it alone can't reach this filter's own branches
    // with a true condition).
    const candidates = [{ name: '', path: '' }, { name: 'Other.jsx' }];
    expect(decideAutoOpenAfterWrite('App.jsx', candidates)).toEqual({
      shouldOpen: false,
      fileName: null,
    });
  });
});

describe('decideAutoOpenAfterWrite boundaries', () => {
  it('declines a basename-fallback candidate that is a module file', () => {
    const files = [{ name: 'App.jsx', path: 'src/App.jsx' }];
    expect(decideAutoOpenAfterWrite('App.jsx', files, { moduleFileNames: new Set(['App.jsx']) })).toEqual({
      shouldOpen: false,
      fileName: null,
    });
  });

  it('opens with a module set that does not contain the resolved name', () => {
    const files = [{ name: 'App.jsx', path: 'src/App.jsx' }];
    expect(decideAutoOpenAfterWrite('src/App.jsx', files, { moduleFileNames: new Set(['Other.jsx']) })).toEqual({
      shouldOpen: true,
      fileName: 'App.jsx',
    });
  });

  it('returns the matched file name, not its path', () => {
    const files = [{ name: 'Display Name', path: 'pages/home.html' }];
    expect(decideAutoOpenAfterWrite('/abs/pages/home.html', files)).toEqual({ shouldOpen: true, fileName: 'Display Name' });
  });

  it('uses an empty path as-is instead of falling back to name, so it never matches', () => {
    const files = [{ name: 'App.jsx', path: '' }];
    expect(decideAutoOpenAfterWrite('App.jsx', files)).toEqual({ shouldOpen: false, fileName: null });
  });

  it('declines a filePath that only ends with the rel path without a slash boundary', () => {
    const files = [{ name: 'App.jsx', path: 'App.jsx' }];
    expect(decideAutoOpenAfterWrite('MyApp.jsx', files)).toEqual({ shouldOpen: false, fileName: null });
  });

  it('declines when nextFiles is empty', () => {
    expect(decideAutoOpenAfterWrite('App.jsx', [])).toEqual({ shouldOpen: false, fileName: null });
  });
});

describe('selectAutoOpenProducedArtifact boundaries', () => {
  it('ranks a file whose kind is html as a page even without an .html extension', () => {
    const files = [
      { name: 'notes.md', mtime: 9 },
      { name: 'page', kind: 'html', mtime: 1 },
    ];
    expect(selectAutoOpenProducedArtifact(files)).toBe('page');
  });

  it('matches .htm and upper-case .HTML extensions as pages', () => {
    expect(selectAutoOpenProducedArtifact([{ name: 'notes.md', mtime: 9 }, { name: 'a.htm' }])).toBe('a.htm');
    expect(selectAutoOpenProducedArtifact([{ name: 'notes.md', mtime: 9 }, { name: 'B.HTML' }])).toBe('B.HTML');
  });

  it('matches .markdown and upper-case .MD as markdown but leaves .txt alone', () => {
    expect(selectAutoOpenProducedArtifact([{ name: 'a.txt', mtime: 9 }, { name: 'doc.markdown' }])).toBe('doc.markdown');
    expect(selectAutoOpenProducedArtifact([{ name: 'a.txt', mtime: 9 }, { name: 'DOC.MD' }])).toBe('DOC.MD');
  });

  it('uses path over name when classifying a file', () => {
    expect(selectAutoOpenProducedArtifact([{ name: 'page.html', path: 'page.txt' }])).toBeNull();
  });

  it('keeps an earlier newer file over a later older one at the same rank', () => {
    const files = [
      { name: 'b.html', mtime: 5 },
      { name: 'a.html', mtime: 1 },
    ];
    expect(selectAutoOpenProducedArtifact(files)).toBe('b.html');
  });

  it('with preferSiteEntry, keeps an earlier newer entry over a later older one at the same depth', () => {
    const files = [
      { name: 'newer', path: 'index.html', mtime: 5 },
      { name: 'older', path: 'index.html', mtime: 1 },
    ];
    expect(selectAutoOpenProducedArtifact(files, { preferSiteEntry: true })).toBe('newer');
  });

  it('with preferSiteEntry, matches an upper-case Index.HTM entry', () => {
    const files = [
      { name: 'page', path: 'page.html', mtime: 9 },
      { name: 'entry', path: 'docs/Index.HTM', mtime: 1 },
    ];
    expect(selectAutoOpenProducedArtifact(files, { preferSiteEntry: true })).toBe('entry');
  });

  it('with preferSiteEntry, does not treat myindex.html as a site entry', () => {
    const files = [
      { name: 'myindex', path: 'myindex.html', mtime: 1 },
      { name: 'page', path: 'page.html', mtime: 9 },
    ];
    expect(selectAutoOpenProducedArtifact(files, { preferSiteEntry: true })).toBe('page');
  });

  it('ignores preferSiteEntry when it is false', () => {
    const files = [
      { name: 'root', path: 'index.html', mtime: 1 },
      { name: 'page', path: 'page.html', mtime: 9 },
    ];
    expect(selectAutoOpenProducedArtifact(files, { preferSiteEntry: false })).toBe('page');
  });

  it('lets an earlier file with a positive finite mtime beat a later non-finite one', () => {
    const files = [
      { name: 'a.html', mtime: 5 },
      { name: 'b.html', mtime: Number.NaN },
    ];
    expect(selectAutoOpenProducedArtifact(files)).toBe('a.html');
  });

  it('returns null for an empty list', () => {
    expect(selectAutoOpenProducedArtifact([], { preferSiteEntry: true })).toBeNull();
  });
});

describe('selectAutoOpenProducedArtifact', () => {
  it('returns null when nothing is previewable', () => {
    expect(selectAutoOpenProducedArtifact([{ name: 'data.json' }])).toBeNull();
  });

  it('prefers html over markdown', () => {
    const files = [
      { name: 'README.md', mtime: 2 },
      { name: 'index.html', mtime: 1 },
    ];
    expect(selectAutoOpenProducedArtifact(files)).toBe('index.html');
  });

  it('breaks ties within the same rank by newest mtime', () => {
    const files = [
      { name: 'a.html', mtime: 1 },
      { name: 'b.html', mtime: 5 },
    ];
    expect(selectAutoOpenProducedArtifact(files)).toBe('b.html');
  });

  it('with preferSiteEntry, picks the shallowest index.html', () => {
    const files = [
      { name: 'sub', path: 'zh/index.html', mtime: 5 },
      { name: 'root', path: 'index.html', mtime: 1 },
    ];
    expect(
      selectAutoOpenProducedArtifact(files, { preferSiteEntry: true }),
    ).toBe('root');
  });

  it('preferSiteEntry falls back to standard rank/mtime when no index.html exists', () => {
    const files = [{ name: 'page.html', mtime: 1 }];
    expect(selectAutoOpenProducedArtifact(files, { preferSiteEntry: true })).toBe('page.html');
  });

  it('preferSiteEntry keeps the shallower entry when a deeper index.html has a newer mtime', () => {
    const files = [
      { name: 'root', path: 'index.html', mtime: 1 },
      { name: 'sub', path: 'zh/index.html', mtime: 99 },
    ];
    expect(selectAutoOpenProducedArtifact(files, { preferSiteEntry: true })).toBe('root');
  });

  it('preferSiteEntry breaks ties at the same depth by newest mtime, treating a missing/non-finite mtime as 0', () => {
    const files = [
      { name: 'first', path: 'index.html', mtime: Number.NaN },
      { name: 'second', path: 'index.html' },
    ];
    // Both normalize to mtime 0; the later one wins ties (>=).
    expect(selectAutoOpenProducedArtifact(files, { preferSiteEntry: true })).toBe('second');
  });

  it('preferSiteEntry breaks a same-depth tie using two genuinely finite mtimes', () => {
    const files = [
      { name: 'first', path: 'index.html', mtime: 1 },
      { name: 'second', path: 'index.html', mtime: 5 },
    ];
    expect(selectAutoOpenProducedArtifact(files, { preferSiteEntry: true })).toBe('second');
  });

  it('preferSiteEntry ignores non-HTML and non-index files entirely', () => {
    const files = [
      { name: 'notes', path: 'notes.md', mtime: 5 },
      { name: 'root', path: 'index.html', mtime: 1 },
    ];
    expect(selectAutoOpenProducedArtifact(files, { preferSiteEntry: true })).toBe('root');
  });

  it('treats a missing/non-finite mtime as 0 for the standard rank/mtime tie-break', () => {
    const files = [
      { name: 'a.html', mtime: Number.POSITIVE_INFINITY },
      { name: 'b.html' },
    ];
    // a.html's non-finite mtime normalizes to 0, so the tie goes to b.html.
    expect(selectAutoOpenProducedArtifact(files)).toBe('b.html');
  });

  it('keeps the higher-ranked selection over a later same-or-lower-rank file', () => {
    const files = [
      { name: 'index.html', mtime: 1 },
      { name: 'README.md', mtime: 99 },
    ];
    expect(selectAutoOpenProducedArtifact(files)).toBe('index.html');
  });
});
