import { describe, expect, it } from 'vitest';
import { conversationTitleForDisplay, deriveConversationTitle, stripConversationTitleMarkdown } from '../../persistence/title.js';

describe('conversation title edges', () => {
  it('retains stop words rather than dropping the prompt', () => {
    expect(deriveConversationTitle({ prompt: 'the and of' })).toBe('The and of');
  });

  it("derives no title when the prompt's first clause is empty", () => {
    expect(deriveConversationTitle({ prompt: '!\nRefactor billing' })).toBe('');
  });

  it('shows a saved title that is only markup as untitled', () => {
    expect(conversationTitleForDisplay({ title: '``~~', titleSource: 'manual' })).toBeNull();
  });
});

// Stryker L5 (2026-10-25): 54 Regex survivors (anchors, `\s{0,3}`, `\s+`→`\s`, `https?`→`https`) —
// no case used http://, reference-link definitions, indented headings or whitespace runs.
describe('title regex edges (F3)', () => {
  it.each([
    ['http URL removed', 'Fix http://x.test/a the header', 'Header'],
    ['https URL removed', 'Fix https://x.test/a the header', 'Header'],
    ['mention and tag removed', 'Fix @bob the #12 header', 'Header'],
    ['quotes removed', 'Build "a" landing page', 'Landing page'],
    ['whitespace runs collapse', 'Build   a \t landing    page', 'Landing page'],
    ['filler: please can you', 'please can you build a landing page', 'Landing page'],
    ['filler: turn this into', 'turn this into a pricing table', 'Pricing table'],
    ['filler only at the start', 'pricing page to build a widget', 'Pricing page to build a widget'],
    ['first clause only', 'Landing page! then more', 'Landing page'],
    ['domain keeps its case', 'example.com redesign', 'example.com redesign'],
    ['CJK filler and punctuation', '帮我做一个登录页面，要好看', '登录页面'],
    ['pure punctuation', '?!', ''],
    ['bare URL', 'http://x.test/a', ''],
    ['punctuation-only clause with no word tokens', '--- ...', ''],
  ])('%s', (_label, prompt, expected) => {
    expect(deriveConversationTitle({ prompt })).toBe(expected);
  });

  it.each([
    ['reference definition removed', 'Intro\n[docs]: http://x.test "T"\nmore', 'Intro more'],
    ['indented (3) reference definition removed', 'Intro\n   [docs]: http://x.test\nmore', 'Intro more'],
    ['4-space indent is not a definition', 'Intro\n    [docs]: x', 'Intro [docs]: x'],
    ['inline link keeps its label', 'see [the docs](http://x.test/(a)) now', 'see the docs now'],
    ['image keeps its alt', '![logo](a.png) mark', 'logo mark'],
    ['reference link keeps its label', 'see [the docs][d] now', 'see the docs now'],
    ['ATX heading marker removed', '## Title', 'Title'],
    ['indented heading marker removed', '   ### Title ###', 'Title'],
    ['7 hashes is not a heading', '####### x', '####### x'],
    ['bold and italic removed', '**bold** and *it*', 'bold and it'],
    ['underscore emphasis removed', '__bold__ and _it_', 'bold and it'],
    ['snake_case untouched', 'snake_case_name', 'snake_case_name'],
    ['inline code and strike', '`code` ~~old~~', 'code old'],
    ['escaped marker stays literal', '\\*not emphasis\\*', '*not emphasis*'],
    ['unclosed fence removed to end', 'Intro ```js\nconst x = 1', 'Intro'],
  ])('%s', (_label, text, expected) => {
    expect(stripConversationTitleMarkdown({ text })).toBe(expected);
  });
});
