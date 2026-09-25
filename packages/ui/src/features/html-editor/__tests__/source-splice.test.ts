// @vitest-environment node
//
// `indexElementSourceRanges`/`spliceElementInner` are pure string/parse5 functions with no DOM
// dependency — routed to Node per this package's own `@vitest-environment node` opt-out pragma
// (see `packages/ui/vitest.config.ts`'s file header and `renderers/__tests__/shiki.ssr.test.ts`
// for the precedent) rather than the package-wide jsdom default.
//
// @file Bug C (see ADS-memory pages-redo plan, "Bug C: one text edit rewrites the whole page's
// HTML") traces the corruption to `serializeEditorContent` rebuilding the **whole document** from
// GrapesJS's own component model on every edit — entities, attribute quoting, and the author's own
// formatting are all lost outside the edited element, not just inside it. `source-splice.ts` is the
// lossless-splice primitive: index every element's source byte range once (`indexElementSourceRanges`),
// then replace only the inner bytes of one addressed element (`spliceElementInner`), leaving every
// other byte of the original string untouched. This file certifies that core in isolation, with no
// GrapesJS or DOM involved — the hook wiring (Slice C2) is out of scope here.
import { describe, expect, it } from 'vitest';

import { indexElementSourceRanges, pathKey, spliceElementInner } from '../source-splice.js';

describe('indexElementSourceRanges', () => {
  it('indexes nested elements by element-only child path', () => {
    const html = '<div><p>one</p><section><span>two</span></section></div>';
    const index = indexElementSourceRanges(html);

    // div -> path [0]; p -> [0,0]; section -> [0,1]; span -> [0,1,0]
    expect(index.get(pathKey([0]))).toBeDefined();
    expect(index.get(pathKey([0, 0]))).toEqual({ start: html.indexOf('one'), end: html.indexOf('</p>'), tagName: 'p' });
    expect(index.get(pathKey([0, 1]))).toBeDefined();
    expect(index.get(pathKey([0, 1, 0]))).toEqual({
      start: html.indexOf('two'),
      end: html.indexOf('</span>'),
      tagName: 'span',
    });
  });

  it('gives void elements (br, img) an empty range and still counts them as a path slot', () => {
    const html = '<div>a<br>b<img src="x.png">c<p>after</p></div>';
    const index = indexElementSourceRanges(html);

    const brRange = index.get(pathKey([0, 0]));
    expect(brRange).toBeDefined();
    expect(brRange!.tagName).toBe('br');
    expect(brRange!.start).toBe(brRange!.end); // void: no inner content, empty range

    const imgRange = index.get(pathKey([0, 1]));
    expect(imgRange).toBeDefined();
    expect(imgRange!.tagName).toBe('img');
    expect(imgRange!.start).toBe(imgRange!.end);

    // <p> is the third element child of <div> (index 2), not shifted by the void elements' own
    // lack of children — void elements still occupy one path slot each among their siblings.
    const pRange = index.get(pathKey([0, 2]));
    expect(pRange).toBeDefined();
    expect(pRange!.tagName).toBe('p');
    expect(html.slice(pRange!.start, pRange!.end)).toBe('after');
  });

  it('skips a leading <style> block entirely from the path — the next element is still index 0', () => {
    const html = '<style>.a{color:red}</style><p>first</p>';
    const index = indexElementSourceRanges(html);

    expect(index.has(pathKey([0]))).toBe(true);
    expect(index.get(pathKey([0]))).toEqual({ start: html.indexOf('first'), end: html.indexOf('</p>'), tagName: 'p' });
    // No entry was created for <style> under any path — it is never a splice target.
    for (const range of index.values()) {
      expect(range.tagName).not.toBe('style');
    }
  });

  it('skips comments and whitespace text nodes — they consume no path slot', () => {
    const html = '<div>\n  <!-- a comment -->\n  <p>content</p>\n</div>';
    const index = indexElementSourceRanges(html);

    expect(index.get(pathKey([0, 0]))).toEqual({
      start: html.indexOf('content'),
      end: html.indexOf('</p>'),
      tagName: 'p',
    });
  });

  it('parses single-quoted attributes (e.g. a data-embed-config marker) without breaking offsets', () => {
    const html = `<div data-embed-config='{"type":"collection","id":"k"}'><p>inner</p></div>`;
    const index = indexElementSourceRanges(html);

    const range = index.get(pathKey([0, 0]));
    expect(range).toBeDefined();
    expect(html.slice(range!.start, range!.end)).toBe('inner');
  });
});

describe('spliceElementInner', () => {
  const fixture =
    '<style>.a { color: red; }</style>\n' +
    `<div data-embed-config='{"id":"k"}' style="color:red">\n` +
    '  <p>Café &mdash; a <b>bold</b> word</p>\n' +
    '  <p>Café &mdash; a <b>bold</b> word</p>\n' +
    '</div>\n';

  it('replaces only the bytes between the tags of the addressed element', () => {
    // <div> is element index 0 (the leading <style> is skipped), first <p> inside it is index 0.
    const path = [0, 0] as const;
    const result = spliceElementInner(fixture, path, 'p', 'Hi');

    expect(result).not.toBeNull();
    const range = indexElementSourceRanges(fixture).get(pathKey(path))!;
    const expectedPrefix = fixture.slice(0, range.start);
    const expectedSuffix = fixture.slice(range.end);

    expect(result!.startsWith(expectedPrefix)).toBe(true);
    expect(result!.endsWith(expectedSuffix)).toBe(true);
    expect(result).toBe(`${expectedPrefix}Hi${expectedSuffix}`);
  });

  it('leaves every byte outside the edited element byte-identical, including entities and quoting', () => {
    const path = [0, 0] as const;
    const result = spliceElementInner(fixture, path, 'p', 'replaced')!;
    const range = indexElementSourceRanges(fixture).get(pathKey(path))!;

    const originalPrefix = fixture.slice(0, range.start);
    const originalSuffix = fixture.slice(range.end);
    const resultPrefix = result.slice(0, range.start);
    const resultSuffix = result.slice(result.length - originalSuffix.length);

    expect(resultPrefix).toBe(originalPrefix);
    expect(resultSuffix).toBe(originalSuffix);
    // The untouched second <p> still carries the raw entity and single/double-quoted attributes
    // exactly as authored — never re-escaped or re-quoted by a round trip through a DOM model.
    expect(result).toContain('&mdash;');
    expect(result).toContain(`data-embed-config='{"id":"k"}'`);
    expect(result).toContain('style="color:red"');
    expect(result).toContain('<style>.a { color: red; }</style>');
  });

  it('drops nested inline markup inside the edited element — the new inner fully replaces the old', () => {
    const path = [0, 0] as const;
    const result = spliceElementInner(fixture, path, 'p', 'plain text only')!;

    // The first <p>'s own <b>bold</b> is gone; the second (untouched) <p>'s <b>bold</b> survives.
    const firstP = result.slice(result.indexOf('<p>'), result.indexOf('</p>') + 4);
    expect(firstP).toBe('<p>plain text only</p>');
    expect(result.match(/<b>bold<\/b>/g)).toHaveLength(1);
  });

  it('addresses the correct sibling among multiple identical elements', () => {
    // Both <p> elements are byte-for-byte identical before the edit; only path [0,1] (the second)
    // should change.
    const secondPath = [0, 1] as const;
    const result = spliceElementInner(fixture, secondPath, 'p', 'Second only')!;

    const paragraphs = [...result.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => m[1]);
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]).toContain('&mdash;');
    expect(paragraphs[0]).toContain('<b>bold</b>');
    expect(paragraphs[1]).toBe('Second only');
  });

  it('preserves custom indentation and whitespace surrounding the edited element', () => {
    const path = [0, 0] as const;
    const result = spliceElementInner(fixture, path, 'p', 'x')!;

    expect(result).toContain('\n  <p>x</p>\n  <p>Café &mdash;');
  });

  it('returns null (a signalled fallback, never a silent wrong splice) for a path that does not resolve', () => {
    expect(spliceElementInner(fixture, [9, 9], 'p', 'x')).toBeNull();
    expect(spliceElementInner(fixture, [0, 0, 0], 'p', 'x')).toBeNull();
  });

  it('returns null when the element at the path has a different tag than expected — a structural drift signal', () => {
    // Path [0,0] resolves to a <p> in the fixture; asking for a <div> at that same path is a
    // caller/document mismatch, not a location to blindly splice into.
    expect(spliceElementInner(fixture, [0, 0], 'div', 'x')).toBeNull();
  });

  it('never treats <style> as reachable through a path — it is not indexed at all', () => {
    // Path [0] in this fixture is the wrapping <div>, not the leading <style> block (skipped from
    // the path entirely) — splicing it replaces the div's inner content, not the stylesheet.
    const result = spliceElementInner(fixture, [0], 'div', 'x')!;
    expect(result).toContain('<style>.a { color: red; }</style>');
    expect(result).not.toContain('<p>');
  });
});
