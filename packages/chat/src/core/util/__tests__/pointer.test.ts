import { describe, expect, it } from 'vitest';
import { resolveHtmlPointerArtifactTarget } from '../../util/index.js';

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
});
