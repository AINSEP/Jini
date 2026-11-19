import { describe, expect, it } from 'vitest';
import {
  designMdDefaultModuleText,
  designMdHeadingMatches,
  designMdHeadings,
  designMdModuleSlice,
  normalizeDesignMdModuleDraft,
  replaceDesignMdModule,
  type DesignMdModule,
} from '../design-md.js';

const TYPOGRAPHY: DesignMdModule = {
  heading: 'Typography',
  keywords: ['typograph', 'type', 'font'],
};

const IDENTITY: DesignMdModule = {
  heading: 'Identity',
  keywords: ['identity', 'overview', 'brand'],
  includePreamble: true,
};

describe('designMdHeadings', () => {
  it('finds every ## heading after startOffset with its absolute start position', () => {
    const body = 'preamble\n\n## Typography\nbody\n\n## Palette\nmore';
    const headings = designMdHeadings({ body, startOffset: 0 });
    expect(headings).toEqual([
      { start: body.indexOf('## Typography'), title: 'Typography' },
      { start: body.indexOf('## Palette'), title: 'Palette' },
    ]);
  });

  it('ignores headings before startOffset', () => {
    const body = '## Typography\nbody\n\n## Palette\nmore';
    const paletteStart = body.indexOf('## Palette');
    const headings = designMdHeadings({ body, startOffset: paletteStart });
    expect(headings).toEqual([{ start: paletteStart, title: 'Palette' }]);
  });

  it('returns an empty array when there are no ## headings', () => {
    expect(designMdHeadings({ body: 'just some text', startOffset: 0 })).toEqual([]);
  });
});

describe('designMdHeadingMatches', () => {
  it('matches case-insensitively against any keyword', () => {
    expect(designMdHeadingMatches({ title: 'TYPOGRAPHY', module: TYPOGRAPHY })).toBe(true);
    expect(designMdHeadingMatches({ title: 'Font Choices', module: TYPOGRAPHY })).toBe(true);
  });

  it('strips a leading numbered-list prefix before matching', () => {
    expect(designMdHeadingMatches({ title: '2. Typography', module: TYPOGRAPHY })).toBe(true);
    expect(designMdHeadingMatches({ title: '3) Typography', module: TYPOGRAPHY })).toBe(true);
  });

  it('returns false when no keyword matches', () => {
    expect(designMdHeadingMatches({ title: 'Voice & Tone', module: TYPOGRAPHY })).toBe(false);
  });
});

describe('designMdDefaultModuleText', () => {
  it('returns a level-1 heading for a preamble module with no existing preamble', () => {
    expect(designMdDefaultModuleText({ module: IDENTITY })).toBe('# Identity\n');
  });

  it('returns the existing preamble verbatim when supplied', () => {
    expect(designMdDefaultModuleText({ module: IDENTITY }, { preamble: 'Existing preamble text' })).toBe('Existing preamble text');
  });

  it('returns a level-2 heading stub for a non-preamble module', () => {
    expect(designMdDefaultModuleText({ module: TYPOGRAPHY })).toBe('## Typography\n\n');
  });
});

describe('designMdModuleSlice', () => {
  it('slices the preamble for a preamble module when the doc has preamble content', () => {
    const body = 'Brand overview text.\n\n## Typography\nfont stuff\n';
    const slice = designMdModuleSlice({ body, module: IDENTITY });
    expect(slice).toEqual({
      text: 'Brand overview text.',
      start: 0,
      end: body.indexOf('## Typography'),
      exists: true,
    });
  });

  it('skips a frontmatter block when computing the preamble', () => {
    const body = '---\ntitle: Brand\n---\nBrand overview.\n\n## Typography\nfont stuff\n';
    const slice = designMdModuleSlice({ body, module: IDENTITY });
    const contentStart = body.indexOf('Brand overview.');
    expect(slice).toEqual({
      text: 'Brand overview.',
      start: contentStart,
      end: body.indexOf('## Typography'),
      exists: true,
    });
  });

  it('slices from the first matching heading through the next heading for a single match', () => {
    const body = 'preamble\n\n## Typography\nfont stuff\n\n## Palette\ncolors\n';
    const slice = designMdModuleSlice({ body, module: TYPOGRAPHY });
    expect(slice.exists).toBe(true);
    expect(slice.text).toBe('## Typography\nfont stuff');
    expect(slice.start).toBe(body.indexOf('## Typography'));
    expect(slice.end).toBe(body.indexOf('## Palette'));
  });

  it('spans from the first to the last matching heading when multiple headings match', () => {
    const body = 'preamble\n\n## Fonts\na\n\n## Type Scale\nb\n\n## Palette\nc\n';
    const module: DesignMdModule = { heading: 'Typography', keywords: ['font', 'type scale'] };
    const slice = designMdModuleSlice({ body, module });
    expect(slice.text).toBe('## Fonts\na\n\n## Type Scale\nb');
    expect(slice.end).toBe(body.indexOf('## Palette'));
  });

  it('extends to the end of the doc when the last matching heading has no following heading', () => {
    const body = 'preamble\n\n## Palette\ncolors\n\n## Typography\nfont stuff';
    const slice = designMdModuleSlice({ body, module: TYPOGRAPHY });
    expect(slice.end).toBe(body.length);
    expect(slice.text).toBe('## Typography\nfont stuff');
  });

  it('returns a default preamble slice when a preamble module has no content and no headings match', () => {
    const body = '## Typography\nfont stuff\n';
    const slice = designMdModuleSlice({ body, module: IDENTITY });
    expect(slice.exists).toBe(false);
    expect(slice.text).toBe('# Identity\n');
    expect(slice.start).toBe(0);
    expect(slice.end).toBe(0);
  });

  it('returns a default appended slice at doc end when a non-preamble module has no match', () => {
    const body = 'preamble\n\n## Palette\ncolors\n';
    const slice = designMdModuleSlice({ body, module: TYPOGRAPHY });
    expect(slice.exists).toBe(false);
    expect(slice.text).toBe('## Typography\n\n');
    expect(slice.start).toBe(body.length);
    expect(slice.end).toBe(body.length);
  });

  it('handles a fully empty document without throwing', () => {
    const slice = designMdModuleSlice({ body: '', module: TYPOGRAPHY });
    expect(slice.exists).toBe(false);
    expect(slice.text).toBe('## Typography\n\n');
  });
});

describe('normalizeDesignMdModuleDraft', () => {
  it('trims a preamble module draft verbatim, no heading prefix added', () => {
    expect(normalizeDesignMdModuleDraft({ module: IDENTITY, draft: '  Some brand text.  ' })).toBe('Some brand text.');
  });

  it('returns a bare heading stub for an empty non-preamble draft', () => {
    expect(normalizeDesignMdModuleDraft({ module: TYPOGRAPHY, draft: '   ' })).toBe('## Typography');
  });

  it('keeps an existing ## heading in a non-preamble draft as-is', () => {
    expect(normalizeDesignMdModuleDraft({ module: TYPOGRAPHY, draft: '## Custom Heading\nbody' })).toBe('## Custom Heading\nbody');
  });

  it('prepends the module heading when the draft has no ## heading', () => {
    expect(normalizeDesignMdModuleDraft({ module: TYPOGRAPHY, draft: 'font stuff' })).toBe('## Typography\n\nfont stuff');
  });
});

describe('replaceDesignMdModule', () => {
  it('replaces an existing module section in place, preserving surrounding content', () => {
    const body = 'preamble\n\n## Typography\nold\n\n## Palette\ncolors\n';
    const next = replaceDesignMdModule({ body, module: TYPOGRAPHY, draft: 'new content' });
    expect(next).toBe('preamble\n\n## Typography\n\nnew content\n\n## Palette\ncolors\n');
  });

  it('appends a new module section when none existed', () => {
    const body = 'preamble\n\n## Palette\ncolors\n';
    const next = replaceDesignMdModule({ body, module: TYPOGRAPHY, draft: 'font stuff' });
    expect(next).toBe('preamble\n\n## Palette\ncolors\n\n## Typography\n\nfont stuff\n');
  });

  it('replaces the preamble for a preamble module', () => {
    const body = 'old preamble\n\n## Typography\nfont stuff\n';
    const next = replaceDesignMdModule({ body, module: IDENTITY, draft: 'new preamble' });
    expect(next).toBe('new preamble\n\n## Typography\nfont stuff\n');
  });

  it('drops an empty before/after part rather than leaving stray blank lines', () => {
    const body = '## Typography\nfont stuff\n';
    const next = replaceDesignMdModule({ body, module: TYPOGRAPHY, draft: 'new content' });
    expect(next).toBe('## Typography\n\nnew content\n');
  });

  it('produces a lone module section when replacing the entire empty document', () => {
    const next = replaceDesignMdModule({ body: '', module: TYPOGRAPHY, draft: 'font stuff' });
    expect(next).toBe('## Typography\n\nfont stuff\n');
  });
});
