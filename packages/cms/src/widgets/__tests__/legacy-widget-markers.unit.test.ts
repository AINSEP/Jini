import * as parse5 from 'parse5';
import { describe, expect, it, vi } from 'vitest';
import { normalizeLegacyWidgetMarkers } from '../html/legacy-widget-markers.js';
import { substituteHtmlEmbeds } from '../html/html-embeds.js';

// Keep the real parser for regressions; only the overlap test supplies inconsistent source ranges.
vi.mock('parse5', async importOriginal => {
  const actual = await importOriginal<typeof import('parse5')>();
  return { ...actual, parseFragment: vi.fn(actual.parseFragment) };
});

describe('legacy widget source edits', () => {
  it('keeps encoded markup inert when formatting reconstruction repeats source locations', () => {
    const html = '<p><b data-embed-type=widget data-embed-id="&lt;x&gt;&lt;img src=x onerror=alert(1)&gt;">1<p>2';
    const normalized = normalizeLegacyWidgetMarkers({ html });
    expect(normalized.match(/data-embed-config=/g)).toHaveLength(1);
    expect(normalized).not.toContain('data-embed-id=');
    const output = substituteHtmlEmbeds({ html, resolve: () => '' });
    // Reparse the output: a literal payload inside a quoted attribute is data, not an image.
    const nodes = [...parse5.parseFragment(output).childNodes];
    const tagNames: string[] = [];
    while (nodes.length) {
      const node = nodes.pop()!;
      if (!('tagName' in node)) continue;
      tagNames.push(node.tagName);
      expect(node.attrs.some(attr => attr.name.startsWith('on'))).toBe(false);
      nodes.push(...node.childNodes);
    }
    expect(tagNames).not.toContain('img');
    expect(tagNames).not.toContain('script');
  });

  it('rejects overlapping original edit ranges rather than emitting corrupted HTML', () => {
    const html = '<b data-embed-type=widget data-embed-id=w1></b>';
    const fragment = parse5.parseFragment(html, { sourceCodeLocationInfo: true });
    const element = fragment.childNodes[0] as parse5.DefaultTreeAdapterMap['element'];
    const locations = element.sourceCodeLocation!.attrs!;
    locations['data-embed-id']!.startOffset = locations['data-embed-type']!.startOffset + 1;
    vi.mocked(parse5.parseFragment).mockReturnValueOnce(fragment);
    expect(() => normalizeLegacyWidgetMarkers({ html })).toThrow('Overlapping legacy widget marker edits');
  });
});
