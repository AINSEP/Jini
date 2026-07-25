import { describe, expect, it } from 'vitest';
import {
  artifactManifestNameFor,
  createArtifactParser,
  createHtmlArtifactManifest,
  inferLegacyManifest,
  matchPersistedArtifactFile,
  parseArtifactManifest,
  parseArtifacts,
  recoverHtmlArtifactFromPrecedingDocument,
  recoverHtmlDocumentFromMarkdownFence,
  recoverStandaloneHtmlDocument,
  resolveHtmlPointerArtifactTarget,
  resolvePersistedArtifactHtml,
  serializeArtifactManifest,
  splitStreamingArtifact,
  stripArtifact,
  stripRecoveredHtmlFallbackForDisplay,
  summarizeArtifactsForTranscript,
  validateHtmlArtifact,
  type ArtifactEvent,
} from '../util/index.js';
import { computeSkipRanges, isRealArtifactOpenAt, rangeContains } from '../util/markdown-context.js';

const HTML_DOC = '<!doctype html><html><head></head><body><h1>Hello there, world</h1></body></html>';

describe('artifacts/parser', () => {
  it('parses a complete artifact block via the one-shot parseArtifacts() convenience wrapper', () => {
    const content = `intro text <artifact identifier="a" type="text/html" title="Demo">${HTML_DOC}</artifact> outro`;
    const events = parseArtifacts(content);
    expect(events[0]).toEqual({ type: 'text', delta: 'intro text ' });
    expect(events[1]).toMatchObject({ type: 'artifact:start', identifier: 'a', artifactType: 'text/html', title: 'Demo' });
    const chunkEvents = events.filter((e): e is Extract<ArtifactEvent, { type: 'artifact:chunk' }> => e.type === 'artifact:chunk');
    expect(chunkEvents.map((e) => e.delta).join('')).toBe(HTML_DOC);
    expect(events.at(-2)).toMatchObject({ type: 'artifact:end', identifier: 'a', fullContent: HTML_DOC });
    expect(events.at(-1)).toEqual({ type: 'text', delta: ' outro' });
  });

  it('reassembles identically whether fed in one chunk or split byte-by-byte across the open tag', () => {
    const content = `<artifact identifier="x" type="text/html" title="T">${HTML_DOC}</artifact>`;
    const whole = parseArtifacts(content);

    const parser = createArtifactParser();
    const streamed: ArtifactEvent[] = [];
    for (const char of content) {
      streamed.push(...parser.feed(char));
    }
    streamed.push(...parser.flush());

    const wholeFull = whole.find((e) => e.type === 'artifact:end');
    const streamedFull = streamed.find((e) => e.type === 'artifact:end');
    expect(streamedFull).toEqual(wholeFull);
  });

  it('does not treat a literal "<artifact ...>" recited inside a fenced code block as a real tag', () => {
    const content = ['Here is the protocol:', '```', '<artifact identifier="demo" type="text/html" title="Demo">...</artifact>', '```', 'end of explanation'].join('\n');
    const events = parseArtifacts(content);
    expect(events.every((e) => e.type === 'text')).toBe(true);
    expect(events.map((e) => (e as { delta: string }).delta).join('')).toBe(content);
  });

  it('holds back an unresolved "<art" prefix at the tail instead of misreading it as plain text', () => {
    const parser = createArtifactParser();
    const first = [...parser.feed('hello <art')];
    // Nothing should flush past the ambiguous prefix yet.
    expect(first).toEqual([{ type: 'text', delta: 'hello ' }]);
    const second = [...parser.feed('ifact identifier="a" type="text/html" title="t">body</artifact>')];
    expect(second[0]).toMatchObject({ type: 'artifact:start', identifier: 'a' });
  });

  it('treats "<artifactual" as a prefix-shared literal, not a real open tag, and keeps scanning past it', () => {
    const content = `no tag here: <artifactual thing then a real one <artifact identifier="a" type="text/html" title="t">${HTML_DOC}</artifact>`;
    const events = parseArtifacts(content);
    expect(events[0]).toMatchObject({ type: 'text' });
    expect((events[0] as { delta: string }).delta).toContain('<artifactual');
    expect(events.some((e) => e.type === 'artifact:start' && e.identifier === 'a')).toBe(true);
  });

  it('holds back an entire buffer that is an unclosed fence containing a look-alike tag, rather than parsing it', () => {
    const parser = createArtifactParser();
    const events = [...parser.feed('```\n<artifact identifier="a" type="text/html" title="t">')];
    expect(events).toEqual([]);
  });

  it('holds back a tail line that could still resolve into a fence opener (e.g. "```ht")', () => {
    const parser = createArtifactParser();
    const events = [...parser.feed('some text\n```ht')];
    expect(events).toEqual([{ type: 'text', delta: 'some text\n' }]);
  });

  it('holds back a tail line that is a lone unmatched backtick or backtick pair', () => {
    const parser = createArtifactParser();
    const events = [...parser.feed('some text\n`')];
    expect(events).toEqual([{ type: 'text', delta: 'some text\n' }]);
  });

  it('holds back an unmatched inline-code backtick and eventually reassembles the full text once it resolves', () => {
    const parser = createArtifactParser();
    const collected: ArtifactEvent[] = [];
    collected.push(...parser.feed('plain text `unterminated'));
    collected.push(...parser.feed(' more`, done.'));
    collected.push(...parser.flush());
    expect(collected.every((e) => e.type === 'text')).toBe(true);
    expect(collected.map((e) => (e as { delta: string }).delta).join('')).toBe('plain text `unterminated more`, done.');
  });

  it('parses single-quoted attribute values the same as double-quoted ones', () => {
    const events = parseArtifacts(`<artifact identifier='a' type='text/html' title='Single Quoted'>${HTML_DOC}</artifact>`);
    expect(events[0]).toMatchObject({ type: 'artifact:start', identifier: 'a', artifactType: 'text/html', title: 'Single Quoted' });
  });

  it('defaults identifier/type/title to empty strings when the open tag has no attributes', () => {
    // "<artifact>" with no space is not a real open tag at all (isRealArtifactOpenAt requires
    // whitespace right after "artifact") — a bare "<artifact >" is the minimal real, attribute-less open.
    const events = parseArtifacts(`<artifact >${HTML_DOC}</artifact>`);
    expect(events[0]).toEqual({ type: 'artifact:start', identifier: '', artifactType: '', title: '' });
  });

  it('flush() emits a trailing chunk plus artifact:end when the stream ends mid-body', () => {
    const parser = createArtifactParser();
    // A body shorter than CLOSE_TAG.length - 1 is held back in full during feed() (nothing is
    // flushed early as a potential partial close-tag match), so flush() alone carries it all.
    [...parser.feed(`<artifact identifier="a" type="text/html" title="t">hi`)];
    const flushed = [...parser.flush()];
    expect(flushed).toEqual([
      { type: 'artifact:chunk', identifier: 'a', delta: 'hi' },
      { type: 'artifact:end', identifier: 'a', fullContent: 'hi' },
    ]);
  });

  it('flush() emits only artifact:end (no empty chunk) when the stream ends exactly at the open tag with no body yet', () => {
    const parser = createArtifactParser();
    [...parser.feed(`<artifact identifier="a" type="text/html" title="t">`)];
    const flushed = [...parser.flush()];
    expect(flushed).toEqual([{ type: 'artifact:end', identifier: 'a', fullContent: '' }]);
  });

  it('flush() emits the held-back buffer as plain text when the stream ends without ever resolving an ambiguous prefix', () => {
    const parser = createArtifactParser();
    [...parser.feed('hello <art')];
    const flushed = [...parser.flush()];
    expect(flushed).toEqual([{ type: 'text', delta: '<art' }]);
  });

  it('flush() is a no-op on a fresh parser with nothing buffered', () => {
    const parser = createArtifactParser();
    expect([...parser.flush()]).toEqual([]);
  });
});

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

describe('artifacts/validate', () => {
  it('accepts a complete HTML document', () => {
    expect(validateHtmlArtifact(HTML_DOC)).toEqual({ ok: true });
  });

  it('rejects prose that merely mentions <html> mid-sentence', () => {
    const result = validateHtmlArtifact('I updated the <html lang> attribute for you, all set!');
    expect(result.ok).toBe(false);
  });

  it('rejects a too-short empty-body document (fixture-grade, not a real deliverable)', () => {
    const result = validateHtmlArtifact('<!doctype html><html><body></body></html>');
    expect(result.ok).toBe(false);
  });

  it('rejects a document whose asset URL points at a reserved workspace-storage path', () => {
    const doc = '<!doctype html><html><body><img src=".workspace/secret.png" alt="leaked-asset-reference-padding"></body></html>';
    const result = validateHtmlArtifact(doc);
    expect(result.ok).toBe(false);
  });

  it('rejects genuinely empty content (distinct from "too short")', () => {
    expect(validateHtmlArtifact('')).toEqual({ ok: false, reason: 'empty content' });
    expect(validateHtmlArtifact('   \n\t  ')).toEqual({ ok: false, reason: 'empty content' });
  });

  it('rejects long prose that never starts with <!doctype html> or <html (distinct from the too-short case)', () => {
    const prose = 'This is a long explanation about what I changed in the document, well over the minimum length threshold.';
    const result = validateHtmlArtifact(prose);
    expect(result).toEqual({
      ok: false,
      reason: 'content does not start with <!doctype html> or <html — looks like prose, not a complete HTML document',
    });
  });

  it('rejects a reserved workspace path referenced from a style="" attribute', () => {
    const doc = `<!doctype html><html><body><div style="background: url('.workspace/secret.png')">padding to clear the minimum length threshold</div></body></html>`;
    expect(validateHtmlArtifact(doc).ok).toBe(false);
  });

  it('rejects a reserved workspace path referenced from a <style> block via url(...)', () => {
    const doc = `<!doctype html><html><head><style>body { background: url(.tmp/secret.png); }</style></head><body>padding to clear the minimum length threshold</body></html>`;
    expect(validateHtmlArtifact(doc).ok).toBe(false);
  });

  it('rejects a reserved workspace path referenced from a <style> block via @import', () => {
    const doc = `<!doctype html><html><head><style>@import ".live-artifacts/theme.css";</style></head><body>padding to clear the minimum length threshold</body></html>`;
    expect(validateHtmlArtifact(doc).ok).toBe(false);
  });

  it('rejects a reserved workspace path buried among multiple srcset candidates', () => {
    const doc = `<!doctype html><html><body><img srcset="a.png 1x, .workspace/b.png 2x" src="a.png" alt="padding to clear the minimum length threshold"></body></html>`;
    expect(validateHtmlArtifact(doc).ok).toBe(false);
  });

  it('still rejects a reserved workspace path even when the attribute value carries a query string', () => {
    const doc = `<!doctype html><html><body><img src=".workspace/secret.png?cachebust=1" alt="padding to clear the minimum length threshold"></body></html>`;
    expect(validateHtmlArtifact(doc).ok).toBe(false);
  });

  it('accepts a document whose URLs are ordinary external/relative paths, not reserved ones', () => {
    const doc = `<!doctype html><html><head><style>body { background: url(https://example.com/x.png); }</style></head><body><img srcset="a.png 1x, b.png 2x" src="c.png" alt="padding to clear the minimum length threshold"></body></html>`;
    expect(validateHtmlArtifact(doc)).toEqual({ ok: true });
  });

  it('detects a reserved workspace path in single-quoted and unquoted URL attribute values, not just double-quoted', () => {
    const singleQuoted = `<!doctype html><html><body><img src='.workspace/secret.png' alt="padding to clear the minimum length threshold"></body></html>`;
    expect(validateHtmlArtifact(singleQuoted).ok).toBe(false);

    const unquoted = `<!doctype html><html><body><img src=.workspace/secret.png alt="padding to clear the minimum length threshold"></body></html>`;
    expect(validateHtmlArtifact(unquoted).ok).toBe(false);
  });

  it('detects a reserved workspace path in a single-quoted or unquoted style="" attribute value', () => {
    const singleQuoted = `<!doctype html><html><body><div style='background:url(".workspace/secret.png")'>padding to clear the minimum length threshold</div></body></html>`;
    expect(validateHtmlArtifact(singleQuoted).ok).toBe(false);

    const unquoted = `<!doctype html><html><body><div style=background:url(.workspace/secret.png)>padding to clear the minimum length threshold</div></body></html>`;
    expect(validateHtmlArtifact(unquoted).ok).toBe(false);
  });

  it('does not let a comma embedded in a data: URI srcset candidate cause a false split, but still flags a later reserved candidate', () => {
    const doc = `<!doctype html><html><body><img srcset="data:image/png;base64,ABCD== 1x, .workspace/leak.png 2x" src="a.png" alt="padding to clear the minimum length threshold"></body></html>`;
    expect(validateHtmlArtifact(doc).ok).toBe(false);
  });
});

describe('artifacts/manifest', () => {
  it('creates, serializes, and round-trips a manifest', () => {
    const manifest = createHtmlArtifactManifest({ entry: 'index.html', title: 'My Page' });
    const parsed = parseArtifactManifest(serializeArtifactManifest(manifest));
    expect(parsed).toEqual(manifest);
  });

  it('rejects a manifest whose exports array contains an unknown export kind', () => {
    const tampered = JSON.stringify({ version: 1, kind: 'html', title: 't', entry: 'e.html', renderer: 'html', exports: ['html', 'exe'] });
    expect(parseArtifactManifest(tampered)).toBeNull();
  });

  it('rejects a manifest with an empty exports array', () => {
    const tampered = JSON.stringify({ version: 1, kind: 'html', title: 't', entry: 'e.html', renderer: 'html', exports: [] });
    expect(parseArtifactManifest(tampered)).toBeNull();
  });

  it('rejects a manifest at an unsupported version', () => {
    const tampered = JSON.stringify({ version: 2, kind: 'html', title: 't', entry: 'e.html', renderer: 'html', exports: ['html'] });
    expect(parseArtifactManifest(tampered)).toBeNull();
  });

  it('infers a legacy manifest kind/renderer from a bare file name, including the deck-name heuristic', () => {
    expect(inferLegacyManifest({ entry: 'notes.md' })).toMatchObject({ kind: 'markdown-document', renderer: 'markdown' });
    expect(inferLegacyManifest({ entry: 'pitch-deck.html' })).toMatchObject({ kind: 'deck', renderer: 'deck-html' });
    expect(inferLegacyManifest({ entry: 'unknownfile.bin' })).toBeNull();
  });

  it('matches a persisted file by manifest identifier even when the file name was collision-renamed', () => {
    const attrs = { identifier: 'my-artifact', type: 'text/html', title: 'T' };
    const files = [{ name: 'my-artifact-2.html', identifier: 'my-artifact' }];
    expect(matchPersistedArtifactFile(attrs, files)).toEqual(files[0]);
  });

  it('falls back to slug/extension matching when no identifier is present', () => {
    const attrs = { title: 'My Cool Page', type: 'text/html' };
    const files = [{ name: 'my-cool-page-3.html' }];
    expect(matchPersistedArtifactFile(attrs, files)).toEqual(files[0]);
  });

  it('artifactManifestNameFor derives the sidecar manifest file name from the entry', () => {
    expect(artifactManifestNameFor('index.html')).toBe('index.html.artifact.json');
  });

  it('parseArtifactManifest rejects malformed JSON rather than throwing', () => {
    expect(parseArtifactManifest('{not valid json')).toBeNull();
  });

  it('parseArtifactManifest rejects a missing/empty entry or title', () => {
    const base = { version: 1, kind: 'html', renderer: 'html', exports: ['html'] };
    expect(parseArtifactManifest(JSON.stringify({ ...base, title: 't', entry: '' }))).toBeNull();
    expect(parseArtifactManifest(JSON.stringify({ ...base, title: '', entry: 'e.html' }))).toBeNull();
    expect(parseArtifactManifest(JSON.stringify({ ...base, title: 't' }))).toBeNull();
  });

  it('parseArtifactManifest rejects a non-string kind or renderer', () => {
    const base = { version: 1, title: 't', entry: 'e.html', exports: ['html'] };
    expect(parseArtifactManifest(JSON.stringify({ ...base, kind: 1, renderer: 'html' }))).toBeNull();
    expect(parseArtifactManifest(JSON.stringify({ ...base, kind: 'html', renderer: 1 }))).toBeNull();
  });

  it('parseArtifactManifest rejects an unrecognized kind or renderer value', () => {
    const base = { version: 1, title: 't', entry: 'e.html', exports: ['html'] };
    expect(parseArtifactManifest(JSON.stringify({ ...base, kind: 'not-a-kind', renderer: 'html' }))).toBeNull();
    expect(parseArtifactManifest(JSON.stringify({ ...base, kind: 'html', renderer: 'not-a-renderer' }))).toBeNull();
  });

  it('parseArtifactManifest rejects an unrecognized status but defaults a missing one to complete', () => {
    const base = { version: 1, kind: 'html', title: 't', entry: 'e.html', renderer: 'html', exports: ['html'] };
    expect(parseArtifactManifest(JSON.stringify({ ...base, status: 'bogus' }))).toBeNull();
    expect(parseArtifactManifest(JSON.stringify(base))?.status).toBe('complete');
    expect(parseArtifactManifest(JSON.stringify({ ...base, status: 'streaming' }))?.status).toBe('streaming');
  });

  it('parseArtifactManifest passes through primary as a string collision-suffix hint or a boolean, dropping any other type', () => {
    const base = { version: 1, kind: 'html', title: 't', entry: 'e.html', renderer: 'html', exports: ['html'] };
    expect(parseArtifactManifest(JSON.stringify({ ...base, primary: 'entry.html' }))?.primary).toBe('entry.html');
    expect(parseArtifactManifest(JSON.stringify({ ...base, primary: true }))?.primary).toBe(true);
    expect(parseArtifactManifest(JSON.stringify({ ...base, primary: 42 }))?.primary).toBeUndefined();
  });

  it('parseArtifactManifest filters supportingFiles to strings only, and drops it entirely when not an array', () => {
    const base = { version: 1, kind: 'html', title: 't', entry: 'e.html', renderer: 'html', exports: ['html'] };
    expect(parseArtifactManifest(JSON.stringify({ ...base, supportingFiles: ['a.css', 42, 'b.js'] }))?.supportingFiles).toEqual(['a.css', 'b.js']);
    expect(parseArtifactManifest(JSON.stringify({ ...base, supportingFiles: 'nope' }))?.supportingFiles).toBeUndefined();
  });

  it('parseArtifactManifest passes through string timestamps/sourceSkillId and drops non-string values', () => {
    const base = { version: 1, kind: 'html', title: 't', entry: 'e.html', renderer: 'html', exports: ['html'] };
    const parsed = parseArtifactManifest(JSON.stringify({ ...base, createdAt: '2024-01-01', updatedAt: '2024-01-02', sourceSkillId: 'skill-1' }));
    expect(parsed).toMatchObject({ createdAt: '2024-01-01', updatedAt: '2024-01-02', sourceSkillId: 'skill-1' });
    const dropped = parseArtifactManifest(JSON.stringify({ ...base, createdAt: 1, updatedAt: 2, sourceSkillId: 3 }));
    expect(dropped).toMatchObject({ createdAt: undefined, updatedAt: undefined, sourceSkillId: undefined });
  });

  it('parseArtifactManifest accepts a null or string designSystemId and drops any other type', () => {
    const base = { version: 1, kind: 'html', title: 't', entry: 'e.html', renderer: 'html', exports: ['html'] };
    expect(parseArtifactManifest(JSON.stringify({ ...base, designSystemId: 'ds-1' }))?.designSystemId).toBe('ds-1');
    expect(parseArtifactManifest(JSON.stringify({ ...base, designSystemId: null }))?.designSystemId).toBeNull();
    expect(parseArtifactManifest(JSON.stringify({ ...base, designSystemId: 7 }))?.designSystemId).toBeUndefined();
  });

  it('parseArtifactManifest accepts a plain-object metadata but drops an array or non-object value', () => {
    const base = { version: 1, kind: 'html', title: 't', entry: 'e.html', renderer: 'html', exports: ['html'] };
    expect(parseArtifactManifest(JSON.stringify({ ...base, metadata: { a: 1 } }))?.metadata).toEqual({ a: 1 });
    expect(parseArtifactManifest(JSON.stringify({ ...base, metadata: ['a'] }))?.metadata).toBeUndefined();
    expect(parseArtifactManifest(JSON.stringify({ ...base, metadata: 'nope' }))?.metadata).toBeUndefined();
  });

  it('inferLegacyManifest recognizes react-component and code-snippet extensions', () => {
    expect(inferLegacyManifest({ entry: 'App.tsx' })).toMatchObject({ kind: 'react-component', renderer: 'react-component' });
    expect(inferLegacyManifest({ entry: 'App.jsx' })).toMatchObject({ kind: 'react-component', renderer: 'react-component' });
    expect(inferLegacyManifest({ entry: 'script.js' })).toMatchObject({ kind: 'code-snippet', renderer: 'code' });
    expect(inferLegacyManifest({ entry: 'styles.css' })).toMatchObject({ kind: 'code-snippet', renderer: 'code' });
  });

  it('inferLegacyManifest recognizes an svg extension and falls back to the plain kind as renderer', () => {
    expect(inferLegacyManifest({ entry: 'icon.svg' })).toMatchObject({ kind: 'svg', renderer: 'svg' });
  });

  it('inferLegacyManifest returns null for a file name with no extension at all', () => {
    expect(inferLegacyManifest({ entry: 'noextension' })).toBeNull();
  });

  it('parseArtifactManifest rejects a non-array exports value that is not even a missing key', () => {
    const tampered = JSON.stringify({ version: 1, kind: 'html', title: 't', entry: 'e.html', renderer: 'html', exports: 'html' });
    expect(parseArtifactManifest(tampered)).toBeNull();
  });

  it('inferLegacyManifest treats an ordinary (non-deck) .html file as kind html, renderer html', () => {
    expect(inferLegacyManifest({ entry: 'page.html' })).toMatchObject({ kind: 'html', renderer: 'html', primary: true });
  });

  it('inferLegacyManifest recognizes the "slides" and "pitch" deck-name heuristics independently of "deck"', () => {
    expect(inferLegacyManifest({ entry: 'my-slides.html' })).toMatchObject({ kind: 'deck', renderer: 'deck-html' });
    expect(inferLegacyManifest({ entry: 'my-pitch.html' })).toMatchObject({ kind: 'deck', renderer: 'deck-html' });
  });

  it('inferLegacyManifest falls back to the entry name as title when no title is given, and forwards metadata', () => {
    const result = inferLegacyManifest({ entry: 'notes.md', metadata: { source: 'test' } });
    expect(result).toMatchObject({ title: 'notes.md', metadata: { source: 'test' } });
  });
});

describe('artifacts/recover', () => {
  it('recovers a standalone HTML document reply as-is', () => {
    expect(recoverStandaloneHtmlDocument(HTML_DOC)).toBe(HTML_DOC);
    expect(recoverStandaloneHtmlDocument('just some prose')).toBeNull();
  });

  it('recoverStandaloneHtmlDocument treats null/undefined sourceText as empty (rejected, not a throw)', () => {
    expect(recoverStandaloneHtmlDocument(null)).toBeNull();
    expect(recoverStandaloneHtmlDocument(undefined)).toBeNull();
  });

  it('recoverStandaloneHtmlDocument rejects a candidate that ends in </html> but is too short to validate', () => {
    expect(recoverStandaloneHtmlDocument('<html></html>')).toBeNull();
  });

  it('recovers HTML from a single fenced ```html block but refuses when there are two candidates (ambiguous)', () => {
    const single = '```html\n' + HTML_DOC + '\n```';
    expect(recoverHtmlDocumentFromMarkdownFence(single)).toBe(HTML_DOC);

    const doubled = single + '\n\n' + single;
    expect(recoverHtmlDocumentFromMarkdownFence(doubled)).toBeNull();
  });

  it('recoverHtmlDocumentFromMarkdownFence treats null/undefined sourceText as empty, and returns null when there is no fence at all', () => {
    expect(recoverHtmlDocumentFromMarkdownFence(null)).toBeNull();
    expect(recoverHtmlDocumentFromMarkdownFence(undefined)).toBeNull();
    expect(recoverHtmlDocumentFromMarkdownFence('no fence here')).toBeNull();
  });

  it('recoverHtmlDocumentFromMarkdownFence skips a fence whose body does not end in </html> and one that is too short to validate', () => {
    const notHtml = '```html\njust some prose, not a document at all really\n```';
    expect(recoverHtmlDocumentFromMarkdownFence(notHtml)).toBeNull();

    const tooShort = '```html\n<html></html>\n```';
    expect(recoverHtmlDocumentFromMarkdownFence(tooShort)).toBeNull();
  });

  it('recoverHtmlArtifactFromPrecedingDocument returns null when the artifact body already validates (no recovery needed)', () => {
    expect(recoverHtmlArtifactFromPrecedingDocument({ artifactHtml: HTML_DOC, sourceText: 'anything' })).toBeNull();
  });

  it('recoverHtmlArtifactFromPrecedingDocument returns null when sourceText is empty/absent', () => {
    expect(recoverHtmlArtifactFromPrecedingDocument({ artifactHtml: 'prose' })).toBeNull();
    expect(recoverHtmlArtifactFromPrecedingDocument({ artifactHtml: 'prose', sourceText: '' })).toBeNull();
  });

  it('recoverHtmlArtifactFromPrecedingDocument returns null when sourceText has no artifact tag at all', () => {
    const result = recoverHtmlArtifactFromPrecedingDocument({ artifactHtml: 'prose', sourceText: HTML_DOC });
    expect(result).toBeNull();
  });

  it('recoverHtmlArtifactFromPrecedingDocument returns null when the text before the artifact tag does not end with </html>', () => {
    const sourceText = `some intro text <artifact identifier="a" type="text/html" title="t">prose</artifact>`;
    expect(recoverHtmlArtifactFromPrecedingDocument({ artifactHtml: 'prose', identifier: 'a', sourceText })).toBeNull();
  });

  it('recoverHtmlArtifactFromPrecedingDocument returns null when the text ends with </html> but no <html open tag precedes it', () => {
    const sourceText = `some prose that happens to end with a close tag </html>\n<artifact identifier="a" type="text/html" title="t">too short</artifact>`;
    expect(recoverHtmlArtifactFromPrecedingDocument({ artifactHtml: 'too short', identifier: 'a', sourceText })).toBeNull();
  });

  it('recovers the complete <html>…</html> document immediately preceding the artifact tag, including a leading doctype', () => {
    const sourceText = `<!doctype html>${HTML_DOC.slice('<!doctype html>'.length)}\n<artifact identifier="a" type="text/html" title="t">too short</artifact>`;
    const result = recoverHtmlArtifactFromPrecedingDocument({ artifactHtml: 'too short', sourceText });
    expect(result).toBe(HTML_DOC);
  });

  it('recovers the preceding document without a doctype when none was present', () => {
    const doc = '<html><head></head><body><h1>No doctype but long enough to pass</h1></body></html>';
    const sourceText = `${doc}\n<artifact identifier="a" type="text/html" title="t">too short</artifact>`;
    const result = recoverHtmlArtifactFromPrecedingDocument({ artifactHtml: 'too short', sourceText });
    expect(result).toBe(doc);
  });

  it('rejects a recovered candidate that is too short to validate as HTML', () => {
    const sourceText = `<html></html>\n<artifact identifier="a" type="text/html" title="t">x</artifact>`;
    expect(recoverHtmlArtifactFromPrecedingDocument({ artifactHtml: 'x', sourceText })).toBeNull();
  });

  it('an identifier param targets the matching-identifier artifact tag, recovering the document immediately before IT, not an earlier one', () => {
    const other = '<html><body>document for the OTHER artifact, long enough to validate on its own</body></html>';
    const mine = '<html><body>document for the TARGET artifact, long enough to validate too</body></html>';
    const sourceText = [
      `${other}`,
      `<artifact identifier="other" type="text/html" title="t">too short</artifact>`,
      `${mine}`,
      `<artifact identifier="a" type="text/html" title="t">too short</artifact>`,
    ].join('\n');
    const result = recoverHtmlArtifactFromPrecedingDocument({ artifactHtml: 'too short', identifier: 'a', sourceText });
    expect(result).toBe(mine);
  });

  it('falls back to the last <artifact tag overall when no tag carries the requested identifier', () => {
    const doc = '<html><body>fallback document, long enough to pass validation on its own merit</body></html>';
    const sourceText = `${doc}\n<artifact type="text/html" title="t">too short</artifact>`;
    const result = recoverHtmlArtifactFromPrecedingDocument({ artifactHtml: 'too short', identifier: 'nope', sourceText });
    expect(result).toBe(doc);
  });

  it('resolvePersistedArtifactHtml prefers the recovered preceding document over the raw artifact body', () => {
    const doc = '<html><body>the real document, long enough to pass the validator on its own</body></html>';
    const sourceText = `${doc}\n<artifact identifier="a" type="text/html" title="t">too short</artifact>`;
    expect(resolvePersistedArtifactHtml({ artifactHtml: 'too short', identifier: 'a', sourceText })).toBe(doc);
  });

  it('resolvePersistedArtifactHtml falls back to the raw artifact body when nothing is recoverable', () => {
    expect(resolvePersistedArtifactHtml({ artifactHtml: HTML_DOC, sourceText: 'irrelevant' })).toBe(HTML_DOC);
    expect(resolvePersistedArtifactHtml({ artifactHtml: 'unrecoverable prose' })).toBe('unrecoverable prose');
  });
});

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

// Not part of the artifacts barrel (see artifacts/markdown-context.ts's own module doc: it's an
// internal detail shared by parser.ts/strip.ts), so this describe block imports the module
// directly rather than through '../artifacts/index.js' like every block above it.
describe('artifacts/markdown-context (internal, direct import)', () => {
  it('treats a heading line as its own inline-code scan region, distinct from surrounding paragraphs', () => {
    const content = '# Heading with `code` inside\nnormal paragraph text';
    const { ranges } = computeSkipRanges(content);
    const codeStart = content.indexOf('`code`');
    expect(ranges.some(([s, e]) => s === codeStart && e === codeStart + '`code`'.length)).toBe(true);
  });

  it('treats an unordered and an ordered list item line as their own inline-code scan regions', () => {
    const ul = computeSkipRanges('- item with `code` here').ranges;
    expect(ul.length).toBe(1);
    const ol = computeSkipRanges('1. item with `code` here').ranges;
    expect(ol.length).toBe(1);
  });

  it('finds multiple inline-code spans within a single paragraph block', () => {
    const content = 'first `one` and second `two` in one paragraph';
    const { ranges } = computeSkipRanges(content);
    expect(ranges).toHaveLength(2);
    const [[s1, e1], [s2, e2]] = ranges as [[number, number], [number, number]];
    expect(content.slice(s1, e1)).toBe('`one`');
    expect(content.slice(s2, e2)).toBe('`two`');
  });

  it('rangeContains reports false for a position outside every range', () => {
    expect(rangeContains([[5, 10]], 20)).toBe(false);
    expect(rangeContains([], 0)).toBe(false);
  });

  it('isRealArtifactOpenAt requires whitespace immediately after "<artifact"', () => {
    expect(isRealArtifactOpenAt('<artifact identifier="a">', 0)).toBe(true);
    expect(isRealArtifactOpenAt('<artifactual', 0)).toBe(false);
    expect(isRealArtifactOpenAt('<artifact', 0)).toBe(false);
  });
});
