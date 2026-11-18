import { describe, expect, it } from 'vitest';
import { toolCallText, toolFamilySentence, unknownToolSentence } from '../tool-call-text.js';

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

describe('toolCallText', () => {
  it('prints the wire name of a directly callable tool', () => {
    expect(toolCallText({ toolId: 'content_read.menu' }, { wireName: 'tool_content_read_menu_0a1b2c3d' })).toBe('tool_content_read_menu_0a1b2c3d');
  });

  it('prints the wire name with the arguments only when the caller passes them', () => {
    expect(toolCallText({ toolId: 'x' }, { wireName: 'x', input: { id: 'a' } })).toBe('x({"id":"a"})');
    expect(toolCallText({ toolId: 'x' }, { wireName: 'x', input: {} })).toBe('x({})');
  });

  it('prints the gateway form with the registry id and an empty input when there is no wire name', () => {
    expect(toolCallText({ toolId: 'third_tool' })).toBe('execute_delegated_tool({"toolId":"third_tool","input":{}})');
  });

  it('uses the read-only gateway for a read-only tool', () => {
    expect(toolCallText({ toolId: 'third_tool' }, { readOnly: true, input: { a: 1 } }))
      .toBe('execute_readonly_delegated_tool({"toolId":"third_tool","input":{"a":1}})');
  });

  it('never puts the wire name in the gateway form: the gateway takes the registry id', () => {
    expect(toolCallText({ toolId: 'content_read.menu' })).toContain('"toolId":"content_read.menu"');
  });
});
