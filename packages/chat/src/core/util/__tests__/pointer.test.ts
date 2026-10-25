import { describe, expect, it } from 'vitest';
import { resolveHtmlPointerArtifactTarget } from '../index.js';

describe('artifacts/pointer', () => {
  it('resolves a bare "see foo.html" reply to the unambiguous matching project file', () => {
    const target = resolveHtmlPointerArtifactTarget({
      content: 'see design.html',
      candidateFileName: 'response.html',
      projectFiles: [{ name: 'design.html' }, { name: 'notes.md' }],
    });
    expect(target).toBe('design.html');
  });

  it('refuses to resolve when the pointer basename matches more than one project file (ambiguous)', () => {
    const target = resolveHtmlPointerArtifactTarget({
      content: 'see design.html',
      candidateFileName: 'response.html',
      projectFiles: [{ name: 'v1/design.html' }, { name: 'v2/design.html' }],
    });
    expect(target).toBeNull();
  });

  it('is not fooled by a long prose reply that happens to end in a filename mention', () => {
    const longProse = `${'x'.repeat(200)} see design.html`;
    const target = resolveHtmlPointerArtifactTarget({
      content: longProse,
      candidateFileName: 'response.html',
      projectFiles: [{ name: 'design.html' }],
    });
    expect(target).toBeNull();
  });

  it('returns null for content that is not a pointer at all', () => {
    const target = resolveHtmlPointerArtifactTarget({
      content: 'just chatting about the weather today',
      candidateFileName: 'response.html',
      projectFiles: [{ name: 'design.html' }],
    });
    expect(target).toBeNull();
  });

  it('returns null when stripping tags leaves nothing (an empty pointer text)', () => {
    const target = resolveHtmlPointerArtifactTarget({
      content: '<script>void 0</script>',
      candidateFileName: 'response.html',
      projectFiles: [],
    });
    expect(target).toBeNull();
  });

  it('strips HTML tags/script/style content and decodes entities before matching the pointer pattern', () => {
    const target = resolveHtmlPointerArtifactTarget({
      content: '<style>.x{}</style><b>see &quot;design.html&quot;</b>',
      candidateFileName: 'response.html',
      projectFiles: [{ name: 'design.html' }],
    });
    expect(target).toBe('design.html');
  });

  it('rejects an unsafe target: an absolute URL scheme', () => {
    const target = resolveHtmlPointerArtifactTarget({
      content: 'see https://evil.example/x.html',
      candidateFileName: 'response.html',
      projectFiles: [{ name: 'x.html' }],
    });
    expect(target).toBeNull();
  });

  it('rejects an unsafe target: an absolute path', () => {
    const target = resolveHtmlPointerArtifactTarget({
      content: 'see /etc/design.html',
      candidateFileName: 'response.html',
      projectFiles: [{ name: 'design.html' }],
    });
    expect(target).toBeNull();
  });

  it('rejects an unsafe target: a path-traversal segment', () => {
    const target = resolveHtmlPointerArtifactTarget({
      content: 'see ../design.html',
      candidateFileName: 'response.html',
      projectFiles: [{ name: 'design.html' }],
    });
    expect(target).toBeNull();
  });

  it('rejects a target that is identical to the candidate file itself (self-pointer)', () => {
    const target = resolveHtmlPointerArtifactTarget({
      content: 'see response.html',
      candidateFileName: 'response.html',
      projectFiles: [{ name: 'response.html' }],
    });
    expect(target).toBeNull();
  });

  it('returns null when the target matches no project file by full path or by basename', () => {
    const target = resolveHtmlPointerArtifactTarget({
      content: 'see missing.html',
      candidateFileName: 'response.html',
      projectFiles: [{ name: 'other.html' }],
    });
    expect(target).toBeNull();
  });

  it('resolves against a project file matched by its full path, not just a basename', () => {
    const target = resolveHtmlPointerArtifactTarget({
      content: 'see design.html',
      candidateFileName: 'response.html',
      projectFiles: [{ name: 'design.html', path: 'subdir/design.html' }],
    });
    expect(target).toBe('subdir/design.html');
  });

  it('rejects a mixed-case extension that POINTER_TARGET_RE (case-insensitive) captures but isSafeHtmlTarget (case-sensitive) does not accept', () => {
    // POINTER_TARGET_RE runs with the `i` flag, so it happily captures "design.Html";
    // isSafeHtmlTarget's own regex has no `i` flag and only accepts all-lower or
    // all-upper html/htm, so mixed case must fall through to null here.
    const target = resolveHtmlPointerArtifactTarget({
      content: 'see design.Html',
      candidateFileName: 'response.html',
      projectFiles: [{ name: 'design.Html' }],
    });
    expect(target).toBeNull();
  });

  it('accepts a pointer of exactly 100 UTF-8 bytes but rejects one of 101', () => {
    const name = (n: number) => `${'a'.repeat(n)}.html`;
    // "see " (4 bytes) + name + ".html" (5 bytes)
    const at = (n: number) => resolveHtmlPointerArtifactTarget({ content: `see ${name(n)}`, candidateFileName: 'r.html', projectFiles: [{ name: name(n) }] });
    expect(at(91)).toBe(name(91));
    expect(at(92)).toBeNull();
  });

  it('counts multi-byte characters by UTF-8 bytes, not string length', () => {
    const file = `${'é'.repeat(46)}.html`; // 92 + 5 = 97 bytes, plus "see " = 101
    expect(resolveHtmlPointerArtifactTarget({ content: `see ${file}`, candidateFileName: 'r.html', projectFiles: [{ name: file }] })).toBeNull();
  });

  it('refuses a unique basename match that is the candidate file itself', () => {
    const target = resolveHtmlPointerArtifactTarget({ content: 'see design.html', candidateFileName: 'v1/design.html', projectFiles: [{ name: 'v1/design.html' }] });
    expect(target).toBeNull();
  });

  it('prefers a file path over its name and ignores non-HTML project files', () => {
    const files = [{ name: 'design.html', path: 'site/design.html' }, { name: 'design.htm.txt' }];
    expect(resolveHtmlPointerArtifactTarget({ content: 'see design.html', candidateFileName: 'r.html', projectFiles: files })).toBe('site/design.html');
  });

  it('accepts a .htm target and the Chinese "见：" form with quotes', () => {
    const target = resolveHtmlPointerArtifactTarget({ content: '见：“page.htm”', candidateFileName: 'r.html', projectFiles: [{ name: 'page.htm' }] });
    expect(target).toBe('page.htm');
  });

  it('rejects an unsafe target containing a backslash', () => {
    expect(resolveHtmlPointerArtifactTarget({ content: 'see a\\b.html', candidateFileName: 'r.html', projectFiles: [{ name: 'a\\b.html' }] })).toBeNull();
  });

  it('rejects an unsafe target with an empty path segment', () => {
    expect(resolveHtmlPointerArtifactTarget({ content: 'see a//b.html', candidateFileName: 'r.html', projectFiles: [{ name: 'a//b.html' }] })).toBeNull();
  });
});

// Stryker L5 (2026-10-25): each clause of the target guard (null / equals candidate / unsafe) and the
// full-path short-circuit survived on its own. One case breaking ONLY that clause.
describe('resolveHtmlPointerArtifactTarget — one clause per case (F3)', () => {
  const files = [{ name: 'design.html' }, { name: 'page.html', path: 'site/page.html' }, { name: 'other.htm' }, { name: 'notes.md' }];
  const resolve = (content: string, candidateFileName = 'new.html', projectFiles = files) =>
    resolveHtmlPointerArtifactTarget({ content, candidateFileName, projectFiles });

  it.each([
    ['plain pointer', 'see design.html', 'design.html'],
    ['chinese colon form', '见：design.html', 'design.html'],
    ['quoted, trailing period', 'See "design.html".', 'design.html'],
    ['full path wins', 'see site/page.html', 'site/page.html'],
    ['basename resolves to its path', 'see page.html', 'site/page.html'],
    ['.htm', 'see other.htm', 'other.htm'],
    ['not a pointer at all', 'design.html', null],
    ['pointer to the candidate itself', 'see new.html', null],
    ['scheme target', 'see https://x.html', null],
    ['absolute target', 'see /etc/design.html', null],
    ['traversal target', 'see ../design.html', null],
    ['backslash target', 'see a\\design.html', null],
    ['unknown file', 'see missing.html', null],
    ['non-html project file never resolves', 'see notes.md', null],
    ['leading junk', 'please see design.html', null],
    ['trailing junk', 'see design.html now', null],
  ])('%s', (_label, content, expected) => {
    expect(resolve(content)).toBe(expected);
  });

  it('a basename shared by two files is ambiguous', () => {
    expect(resolve('see a.html', 'new.html', [{ name: 'a.html', path: 'x/a.html' }, { name: 'a.html', path: 'y/a.html' }])).toBeNull();
  });

  it('a lone basename match that IS the candidate path is refused', () => {
    expect(resolve('see a.html', 'x/a.html', [{ name: 'a.html', path: 'x/a.html' }])).toBeNull();
  });

  it('the full-path match short-circuits even when the basename is ambiguous', () => {
    expect(resolve('see x/a.html', 'new.html', [{ name: 'a.html', path: 'x/a.html' }, { name: 'a.html', path: 'y/a.html' }])).toBe('x/a.html');
  });

  it('a pointer longer than 100 UTF-8 bytes is not a pointer', () => {
    const name = 'd'.repeat(87) + '.html'; // "see " + 92 = 96 bytes
    expect(resolve(`see ${name}`, 'new.html', [{ name }])).toBe(name);
    const long = 'd'.repeat(92) + '.html'; // 101 bytes
    expect(resolve(`see ${long}`, 'new.html', [{ name: long }])).toBeNull();
    const multi = 'é'.repeat(46) + '.html'; // "see " + 92 bytes + 5 = 101 bytes, 55 chars
    expect(resolve(`see ${multi}`, 'new.html', [{ name: multi }])).toBeNull();
  });

  it('tags, script/style bodies, BOM and entities are stripped before matching', () => {
    expect(resolve('﻿<p>see <code>design.html</code></p><script>x()</script>')).toBe('design.html');
    expect(resolve('<style>p{}</style>see &quot;design.html&quot;')).toBe('design.html');
  });
});
