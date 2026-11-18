import { describe, expect, it } from 'vitest';
import { unknownToolSentence } from '../tool-call-text.js';

describe('unknownToolSentence', () => {
  it('names the closest registered ids and where to search', () => {
    expect(unknownToolSentence({ toolId: 'content_reed', candidates: ['content_read.menu', 'content_read.page'] }))
      .toBe('There is no tool named "content_reed". Closest names: content_read.menu, content_read.page. Find tools with search_tools.');
  });

  it('leaves the closest-names part out when there are no candidates', () => {
    expect(unknownToolSentence({ toolId: 'zzz', candidates: [] })).toBe('There is no tool named "zzz". Find tools with search_tools.');
  });

  it('never says the call was denied or refused', () => {
    expect(unknownToolSentence({ toolId: 'x', candidates: ['y'] })).not.toMatch(/denied|refused|registered/);
  });
});
