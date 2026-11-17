import { describe, expect, it } from 'vitest';
import { toolFamilySentence, unknownToolSentence } from '../tool-call-text.js';

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

describe('toolFamilySentence', () => {
  it('says the id is a group and lists the members to call', () => {
    expect(toolFamilySentence({ familyId: 'fam', members: ['fam.a', 'fam.b'] }))
      .toBe('"fam" is a group of tools, not one tool. Call one of: fam.a, fam.b.');
  });

  it('never says the call was denied or refused', () => {
    expect(toolFamilySentence({ familyId: 'fam', members: ['fam.a'] })).not.toMatch(/denied|refused|registered/);
  });
});
