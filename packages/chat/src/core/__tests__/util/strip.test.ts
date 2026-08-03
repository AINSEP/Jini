import { describe, expect, it } from 'vitest';
import {
  matchPersistedArtifactFile,
  recoverHtmlDocumentFromMarkdownFence,
  splitStreamingArtifact,
  stripArtifact,
  stripRecoveredHtmlFallbackForDisplay,
  summarizeArtifactsForTranscript,
} from '../../util/index.js';

const HTML_DOC = '<!doctype html><html><head></head><body><h1>Hello there, world</h1></body></html>';

// This block is primarily strip.ts, but also covers one recover.ts edge case
// (recoverHtmlDocumentFromMarkdownFence's empty-fence-body handling) that was originally
// authored alongside the closely-related stripRecoveredHtmlFallbackForDisplay empty-fence
// test right above it — kept together per the mechanical-split rule rather than relocated.
describe('artifacts/strip', () => {
  it('removes a real artifact block and trims the surrounding whitespace', () => {
    const content = `before\n<artifact identifier="a" type="text/html" title="T">${HTML_DOC}</artifact>\nafter`;
    const stripped = stripArtifact(content);
    expect(stripped).not.toContain('<artifact');
    expect(stripped).toBe('before\n\nafter');
  });

  it('leaves a literal "<artifact>" recited in a fenced code block untouched', () => {
    const content = ['explaining the protocol:', '```', '<artifact identifier="a" type="text/html" title="t">body</artifact>', '```'].join('\n');
    expect(stripArtifact(content)).toBe(content);
  });

  it('refuses to strip a malformed block with a real open tag but no real close tag (fail-closed)', () => {
    const content = `text <artifact identifier="a" type="text/html" title="t">unterminated body`;
    expect(stripArtifact(content)).toBe(content);
  });

  it('summarizes only artifacts confirmed persisted, leaving unconfirmed ones verbatim (aggregate: mixed batch)', () => {
    const content = [
      '<artifact identifier="saved-one" type="text/html" title="Saved">' + HTML_DOC + '</artifact>',
      'and also',
      '<artifact identifier="unsaved-one" type="text/html" title="Unsaved">' + HTML_DOC + '</artifact>',
    ].join('\n');
    const result = summarizeArtifactsForTranscript(content, [{ name: 'saved.html', identifier: 'saved-one' }]);
    expect(result).toContain('saved.html');
    expect(result).not.toContain('<artifact identifier="saved-one"'); // the confirmed block's body was replaced with a summary
    expect(result).toContain('<artifact identifier="unsaved-one"'); // the unconfirmed block survives verbatim, tag and all
  });

  it('splitStreamingArtifact surfaces an in-flight block and hides its raw open tag from the Markdown head', () => {
    const content = `Building your page now.\n<artifact identifier="live" type="text/html" title="Live">${HTML_DOC.slice(0, 20)}`;
    const { head, live } = splitStreamingArtifact(content);
    expect(head).toBe('Building your page now.');
    expect(live).toMatchObject({ identifier: 'live', artifactType: 'text/html', title: 'Live' });
    expect(live?.content).toBe(HTML_DOC.slice(0, 20));
  });

  it('splitStreamingArtifact defers to stripArtifact once the close tag has already arrived', () => {
    const content = `head <artifact identifier="a" type="text/html" title="t">${HTML_DOC}</artifact>`;
    const { live } = splitStreamingArtifact(content);
    expect(live).toBeNull();
  });

  it('finds the real close tag past a literal "</artifact>" recited inside inline code', () => {
    const content = 'text <artifact identifier="a" type="text/html" title="t">See `</artifact>` written literally, then the real end.</artifact> trailing';
    const stripped = stripArtifact(content);
    expect(stripped).toBe('text  trailing');
  });

  it('refuses to strip when the open tag itself never terminates with ">"', () => {
    const content = 'text <artifact identifier="a"';
    expect(stripArtifact(content)).toBe(content);
  });

  it('parses single-quoted attribute values in the open tag, not just double-quoted', () => {
    const content = `text <artifact identifier='a' type='text/html' title='t'>${HTML_DOC}</artifact> trailing`;
    expect(stripArtifact(content)).toBe('text  trailing');
  });

  it(
    'terminates promptly on many false-positive close-tag matches inside skip ranges, instead of hanging (regression test for findUnskipped/findRealOpen\'s for(;;) loops)',
    () => {
      // 500 literal "</artifact>" occurrences, each wrapped in backticks so
      // computeSkipRanges treats them as inline code (a skip range) — forces
      // findUnskipped to advance past all 500 false matches before it reaches
      // the real close tag. A low explicit timeout means a future change that
      // broke the indexOf-based termination this file relies on (see the
      // comments on findUnskipped/findRealOpen) fails this test fast and by
      // name, instead of only surfacing as a mysteriously slow/hung test run.
      const decoys = Array.from({ length: 500 }, () => '`</artifact>`').join(' ');
      const content = `text <artifact identifier="a" type="text/html" title="t">${decoys} real body</artifact> trailing`;
      expect(stripArtifact(content)).toBe('text  trailing');
    },
    1000,
  );

  it('picks the correct on-disk extension for each artifact kind when falling back to slug matching', () => {
    const cases: Array<[Record<string, string>, string]> = [
      [{ title: 'My Comp', type: 'react-component/tsx' }, 'my-comp.tsx'],
      [{ title: 'My Comp', type: 'text/jsx' }, 'my-comp.jsx'],
      [{ title: 'My Styles', type: 'text/css' }, 'my-styles.css'],
      [{ title: 'My Icon', type: 'image/svg' }, 'my-icon.svg'],
      [{ title: 'My Notes', type: 'text/markdown' }, 'my-notes.md'],
    ];
    for (const [attrs, fileName] of cases) {
      expect(matchPersistedArtifactFile(attrs, [{ name: fileName }])).toEqual({ name: fileName });
    }
  });

  it('derives the extension from the identifier suffix when the type is absent', () => {
    // artifactBaseNameForAttrs slugifies the *whole* identifier (dots become dashes), so
    // "thing.tsx" becomes base "thing-tsx", matched against "thing-tsx(-N)?.tsx".
    expect(matchPersistedArtifactFile({ identifier: 'thing.tsx' }, [{ name: 'thing-tsx-2.tsx' }])).toEqual({ name: 'thing-tsx-2.tsx' });
  });

  it('falls back to the literal name "artifact" when identifier/title are absent or collapse to nothing', () => {
    expect(matchPersistedArtifactFile({ type: 'text/html' }, [{ name: 'artifact.html' }])).toEqual({ name: 'artifact.html' });
    expect(matchPersistedArtifactFile({ title: '!!!', type: 'text/html' }, [{ name: 'artifact.html' }])).toEqual({ name: 'artifact.html' });
  });

  it('summarizeArtifactsForTranscript leaves the tail untouched when a real open tag never terminates with ">"', () => {
    const content = '<artifact identifier="a" type="text/html" title="t"';
    expect(summarizeArtifactsForTranscript(content, [{ name: 'x.html', identifier: 'a' }])).toBe(content);
  });

  it('summarizeArtifactsForTranscript leaves the tail untouched when a real open tag has no matching real close', () => {
    const content = '<artifact identifier="a" type="text/html" title="t">unterminated body';
    expect(summarizeArtifactsForTranscript(content, [{ name: 'x.html', identifier: 'a' }])).toBe(content);
  });

  it('summarizeArtifactsForTranscript leaves a literal-looking "<artifact>" inside a trailing UNTERMINATED fence untouched (not summarized)', () => {
    const content = 'intro\n```\nliteral <artifact identifier="x" type="text/html" title="t">body</artifact> inside an unterminated fence';
    expect(summarizeArtifactsForTranscript(content, [{ name: 'x.html', identifier: 'x' }])).toBe(content);
  });

  it('summarizeArtifactsForTranscript falls back to empty identifier/title in the summary line when the block omits them', () => {
    const content = `<artifact type="text/html">${HTML_DOC}</artifact>`;
    const result = summarizeArtifactsForTranscript(content, [{ name: 'artifact.html' }]);
    expect(result).toContain('artifact.html');
    expect(result).not.toContain('identifier=');
    expect(result).not.toContain('title=');
    expect(result).toContain('type="text/html"');
  });

  it('splitStreamingArtifact shows an empty live placeholder while the open tag attributes are still streaming in', () => {
    const content = 'Building now.\n<artifact identifier="live"';
    const { head, live } = splitStreamingArtifact(content);
    expect(head).toBe('Building now.');
    expect(live).toEqual({ artifactType: '', title: '', identifier: '', content: '' });
  });

  it('splitStreamingArtifact does not treat a non-HTML/text artifact type as a live code preview', () => {
    const content = '<artifact identifier="a" type="image/png" title="t">binarydatastreamingin';
    const { live } = splitStreamingArtifact(content);
    expect(live).toBeNull();
  });

  it('splitStreamingArtifact treats a complete open tag that omits "type" entirely as code-eligible (unknown type defaults to empty, not excluded)', () => {
    const content = '<artifact identifier="a" title="t">body streaming in, no type attr at all';
    const { live } = splitStreamingArtifact(content);
    expect(live).toMatchObject({ identifier: 'a', title: 't', artifactType: '' });
  });

  it('splitStreamingArtifact parses single-quoted open-tag attributes the same as double-quoted ones', () => {
    const content = "<artifact identifier='a' type='text/html' title='t'>body streaming";
    const { live } = splitStreamingArtifact(content);
    expect(live).toMatchObject({ identifier: 'a', artifactType: 'text/html', title: 't' });
  });

  it('splitStreamingArtifact treats a literal-looking "<artifact>" inside a trailing UNTERMINATED fence (a standalone ``` line with no closing ```) as inert text, not a live block', () => {
    // The fence-open line must be a standalone ``` (optionally + lang) line per
    // FENCE_OPEN_RE — this is what actually sets `unclosedFenceStart`, unlike a
    // backtick sequence embedded mid-line.
    const content = 'prose\n```\nliteral <artifact fake="1"> tag inside an unterminated fence, still streaming';
    const { head, live } = splitStreamingArtifact(content);
    expect(live).toBeNull();
    expect(head).toBe(content);
  });

  it('stripRecoveredHtmlFallbackForDisplay removes a recovered preceding document that duplicates one behind an artifact tag, keeping the artifact tag itself', () => {
    const doc = '<html><body>the real document, long enough to pass the validator on its own merit here</body></html>';
    const content = `${doc}\n<artifact identifier="a" type="text/html" title="t">too short</artifact>`;
    const result = stripRecoveredHtmlFallbackForDisplay(content);
    expect(result).not.toContain('<html>');
    expect(result).toContain('<artifact identifier="a"');
  });

  it('stripRecoveredHtmlFallbackForDisplay clears the bubble entirely when the whole content IS a standalone HTML document', () => {
    expect(stripRecoveredHtmlFallbackForDisplay(HTML_DOC)).toBe('');
  });

  it('stripRecoveredHtmlFallbackForDisplay strips a single recoverable ```html fence when nothing else recovers', () => {
    const content = `Here you go:\n\`\`\`html\n${HTML_DOC}\n\`\`\`\nenjoy!`;
    const result = stripRecoveredHtmlFallbackForDisplay(content);
    expect(result).toBe('Here you go:\n\nenjoy!');
  });

  it('stripRecoveredHtmlFallbackForDisplay leaves content untouched when nothing is recoverable', () => {
    const content = 'just a normal chat reply with no artifacts or documents';
    expect(stripRecoveredHtmlFallbackForDisplay(content)).toBe(content);
  });

  it('stripRecoveredHtmlFallbackForDisplay treats a separate sourceText that does not contain the recovered doc as unmatched, falling through to the next strategy', () => {
    const doc = '<html><body>the real document, long enough to pass the validator on its own merit here</body></html>';
    const sourceText = `${doc}\n<artifact identifier="a" type="text/html" title="t">too short</artifact>`;
    // `content` (the display copy) is a totally different string, so the recovered document text
    // from `sourceText` cannot be found inside it — stripRecoverablePrecedingHtml's
    // `content.lastIndexOf(recovered) === -1` path — and since `content` itself is not a
    // standalone document or a fenced one either, it is returned unchanged.
    const content = 'an unrelated chat bubble';
    expect(stripRecoveredHtmlFallbackForDisplay(content, sourceText)).toBe(content);
  });

  it('findRecoverablePrecedingHtmlArtifact skips past a real artifact block that needs no recovery and keeps scanning for one that does', () => {
    const doc = '<html><body>the recoverable document, long enough to pass validation on its own</body></html>';
    const sourceText = [
      `<artifact identifier="first" type="text/html" title="t">${HTML_DOC}</artifact>`,
      `${doc}`,
      `<artifact identifier="second" type="text/html" title="t">too short</artifact>`,
    ].join('\n');
    const result = stripRecoveredHtmlFallbackForDisplay(sourceText);
    expect(result).not.toContain('<html><body>the recoverable document');
    // The first artifact's own already-valid body is untouched by recovery.
    expect(result).toContain(HTML_DOC);
  });

  it('findRecoverablePrecedingHtmlArtifact stops scanning (returns null) when a real open tag never terminates with ">"', () => {
    const sourceText = 'text <artifact identifier="a"';
    expect(stripRecoveredHtmlFallbackForDisplay(sourceText)).toBe(sourceText);
  });

  it('findRecoverablePrecedingHtmlArtifact returns null when a real open tag has no matching real close tag', () => {
    const doc = '<html><body>irrelevant document, long enough to pass validation on its own merit</body></html>';
    const sourceText = `${doc}\n<artifact identifier="a" type="text/html" title="t">unterminated, no close tag at all`;
    expect(stripRecoveredHtmlFallbackForDisplay(sourceText)).toBe(sourceText);
  });

  it('still recovers correctly when the source text also contains a trailing unclosed fence elsewhere', () => {
    const doc = '<html><body>the real document, long enough to pass the validator on its own merit here</body></html>';
    const sourceText = `${doc}\n<artifact identifier="a" type="text/html" title="t">too short</artifact>\n\`\`\`\nunclosed trailing fence`;
    const result = stripRecoveredHtmlFallbackForDisplay(sourceText);
    expect(result).not.toContain('<html>');
    expect(result).toContain('<artifact identifier="a"');
  });

  it('findSingleRecoverableHtmlFence handles an empty fence body without throwing', () => {
    const content = 'prose\n```html\n\n```\nmore prose';
    expect(stripRecoveredHtmlFallbackForDisplay(content)).toBe(content);
  });

  it('recoverHtmlDocumentFromMarkdownFence handles an empty fence body without throwing (rejected, not a crash)', () => {
    expect(recoverHtmlDocumentFromMarkdownFence('```html\n\n```')).toBeNull();
  });

  it('summarizeArtifactsForTranscript defaults type to text/html in the summary line when the block omits it', () => {
    const content = `<artifact identifier="a">${HTML_DOC}</artifact>`;
    const result = summarizeArtifactsForTranscript(content, [{ name: 'a.html', identifier: 'a' }]);
    expect(result).toContain('type="text/html"');
  });

  it('splitStreamingArtifact defaults type/title/identifier to empty strings on a live block whose open tag omits them', () => {
    const content = '<artifact type="text/html">partial body streaming in';
    const { live } = splitStreamingArtifact(content);
    expect(live).toMatchObject({ identifier: '', title: '', artifactType: 'text/html' });
  });

  it('splitStreamingArtifact still detects the live block correctly when an unclosed fence appears later in its own streaming body', () => {
    const content = '<artifact identifier="a" type="text/html" title="t">body with ```\nunclosed code fence inside';
    const { live } = splitStreamingArtifact(content);
    expect(live).toMatchObject({ identifier: 'a', artifactType: 'text/html', title: 't' });
  });
});
