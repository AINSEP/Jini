import { describe, expect, it } from 'vitest';
import { MarkdownRenderer, renderMarkdownToSafeHtml } from '../markdown.js';
import type { ArtifactFile } from '../../types.js';

describe('renderMarkdownToSafeHtml', () => {
  it('renders basic markdown to HTML', () => {
    expect(renderMarkdownToSafeHtml('# Title\n\nHello **world**.')).toContain('<h1>Title</h1>');
  });

  it('adds rel=noreferrer/target=_blank to external links', () => {
    const html = renderMarkdownToSafeHtml('[Anthropic](https://anthropic.com)');
    expect(html).toContain('rel="noreferrer noopener" target="_blank"');
    expect(html).toContain('href="https://anthropic.com"');
  });

  it('does not add target=_blank to in-page anchor links', () => {
    const html = renderMarkdownToSafeHtml('[Jump](#section)');
    expect(html).not.toContain('target="_blank"');
  });

  it('drops links with an unsafe scheme', () => {
    const html = renderMarkdownToSafeHtml('[bad](javascript:alert(1))');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('bad');
  });

  it('escapes pipes inside inline code within a table cell', () => {
    const md = '| a | b |\n| --- | --- |\n| `x|y` | z |';
    const html = renderMarkdownToSafeHtml(md);
    expect(html).toContain('md-table');
    expect(html).toContain('x|y');
  });

  it('wraps tables in a scroll container class', () => {
    const md = '| a | b |\n| --- | --- |\n| 1 | 2 |';
    expect(renderMarkdownToSafeHtml(md)).toContain('md-table-wrap');
  });

  it('does not mistake pipes inside a fenced code block for a table, even one that looks like a table header', () => {
    const md = '```\n| this | looks | like | a | table | header |\n| --- | --- | --- | --- | --- | --- |\n```';
    const html = renderMarkdownToSafeHtml(md);
    // A real table would produce a md-table wrapper; a fenced block must not.
    expect(html).not.toContain('md-table');
    expect(html).toContain('<pre>');
  });

  it('ends table-cell-pipe-escaping once a table is followed by a plain non-pipe line', () => {
    const md = '| a | b |\n| --- | --- |\n| 1 | 2 |\n\nJust a paragraph, no pipes here.';
    const html = renderMarkdownToSafeHtml(md);
    expect(html).toContain('md-table-wrap');
    expect(html).toContain('Just a paragraph, no pipes here.');
  });

  it('falls back to the raw decoded href when it contains a malformed percent-escape decodeURIComponent cannot parse', () => {
    const html = renderMarkdownToSafeHtml('[bad link](https://example.com/%E0%A4%A)');
    // decodeURIComponent throws on the truncated %A4%A sequence; the href
    // must still render (using the un-decoded string) instead of crashing.
    expect(html).toContain('<a href=');
    expect(html).toContain('bad link');
  });
});

describe('MarkdownRenderer', () => {
  function file(overrides: Partial<ArtifactFile> = {}): ArtifactFile {
    return { name: 'notes.md', kind: 'text', content: '# hi', ...overrides };
  }

  it('supports streaming and exposes renderPartial', () => {
    expect(MarkdownRenderer.supportsStreaming).toBe(true);
    expect(MarkdownRenderer.renderPartial?.('# hi')).toContain('<h1>hi</h1>');
  });

  it('no longer matches a .md file with no manifest (inference removed)', () => {
    expect(MarkdownRenderer.canRender({ file: file() })).toBe(false);
  });

  it('matches an explicit markdown-document manifest', () => {
    const manifest = {
      version: 1 as const,
      kind: 'markdown-document' as const,
      title: 't',
      entry: 'a',
      renderer: 'markdown' as const,
      exports: [],
    };
    expect(MarkdownRenderer.canRender({ file: file({ manifest, name: 'a' }) })).toBe(true);
  });

  it('refuses a non-markdown text file', () => {
    expect(MarkdownRenderer.canRender({ file: file({ name: 'notes.txt' }) })).toBe(false);
  });
});
