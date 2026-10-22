/**
 * `deriveConversationTitle` — the no-model, no-latency title a conversation gets the instant it
 * appears in a list.
 *
 * The cases below are the ones that made the original heuristic worth porting rather than
 * replacing with `prompt.slice(0, 40)`: filler stripping, stop-word removal, and the refusal to
 * title a conversation after a pasted URL or code block.
 */
import { describe, expect, it } from 'vitest';

import { conversationTitleForDisplay, deriveConversationTitle, stripConversationTitleMarkdown } from '../../persistence/title.js';

describe('deriveConversationTitle', () => {
  it.each([
    ['# **Plannie** and _marketplace_ with `API`', 'Plannie Marketplace Api'],
    ['Build [Plannie](https://plannie.com) marketplace', 'Plannie Marketplace'],
    ['Build **Plannie** at **plannie', 'Plannie At Plannie'],
    ['## **博客** 的 _搜索_ 功能', '博客的搜索功能'],
  ])('strips markdown before deriving a bounded title: %s', (prompt, title) => {
    expect(deriveConversationTitle({ prompt })).toBe(title);
  });

  it('cuts long Latin titles at a word boundary', () => {
    const word = 'a'.repeat(50);
    expect(deriveConversationTitle({ prompt: `alpha ${word} ${word}` })).toBe(`Alpha ${'A' + word.slice(1)}`);
  });

  it.each(['generated', 'fallback', 'manual'] as const)('cleans a stored %s title without a transcript or a write', titleSource => {
    expect(conversationTitleForDisplay({ title: 'Page: **Plannie** at **plannie', titleSource })).toBe('Page: Plannie at **plannie');
    expect(conversationTitleForDisplay({ title: '# [Plannie](https://plannie.com) *marketplace* `API`', titleSource })).toBe('Plannie marketplace API');
  });

  it('bounds stored titles after removing markup and uses the last complete word', () => {
    expect(conversationTitleForDisplay({ title: `**Plannie** ${'x'.repeat(70)} finalword`, titleSource: 'generated' }))
      .toBe(`Plannie ${'x'.repeat(70)}`);
  });

  it('keeps link labels, inline code and underscores inside identifiers', () => {
    expect(stripConversationTitleMarkdown({ text: '### **Plannie** _marketplace_ `API_key` [home](https://example.com) [docs][ref]\n[ref]: https://example.com' }))
      .toBe('Plannie marketplace API_key home docs');
    expect(stripConversationTitleMarkdown({ text: '```ts\nconst x = 1\n```' })).toBe('');
    expect(stripConversationTitleMarkdown({ text: '```ts\nconst x = 1' })).toBe('');
    expect(conversationTitleForDisplay({ title: '**', titleSource: 'generated' })).toBe('**');
    expect(stripConversationTitleMarkdown({ text: '[Plannie](https://example.com/path_(page))' })).toBe('Plannie');
    expect(deriveConversationTitle({ prompt: 'Fix `login` bug' })).toBe('Login Bug');
  });

  it.each([
    ['**bold** *italic* _emphasis_ __strong__', 'bold italic emphasis strong'],
    ['Rename *.ts files', 'Rename *.ts files'],
    ['__dirname and API_key', '__dirname and API_key'],
    ['prefix_word_suffix and prefix__word__suffix', 'prefix_word_suffix and prefix__word__suffix'],
    ['**unfinished and _unfinished', '**unfinished and _unfinished'],
    [String.raw`Rename \* files`, 'Rename * files'],
    [String.raw`Use \*literal\* and **bold**`, 'Use *literal* and bold'],
    ['Page: [Plannie', 'Page: Plannie'],
    ['Page: [', 'Page:'],
    ['(**bold**) and (_word_)', '(bold) and (word)'],
  ])('strips paired emphasis while retaining literal text: %s', (text, expected) => {
    expect(stripConversationTitleMarkdown({ text })).toBe(expected);
  });

  it('keeps a whole word that ends exactly at the character ceiling', () => {
    const title = `${'x'.repeat(70)} ${'y'.repeat(9)}`;
    expect(conversationTitleForDisplay({ title: `${title} **next**`, titleSource: 'generated' })).toBe(title);
  });

  it('cleans links whose destination was already cut off in a stored title', () => {
    expect(conversationTitleForDisplay({ title: 'Page: [Plannie](https://planni', titleSource: 'generated' })).toBe('Page: Plannie');
    expect(conversationTitleForDisplay({ title: 'Page: [Plannie][ref', titleSource: 'generated' })).toBe('Page: Plannie');
  });

  it('can display sentence case without losing proper names or acronyms from the original prompt', () => {
    const prompt = 'I want to connect a Mailchimp account using API keys';
    expect(deriveConversationTitle({ prompt }, { casing: 'sentence' })).toBe('I want connect Mailchimp account using');
    const acronymPrompt = 'Fix the API login bug';
    expect(deriveConversationTitle({ prompt: acronymPrompt }, { casing: 'sentence' })).toBe('API login bug');
    expect(conversationTitleForDisplay({ title: deriveConversationTitle({ prompt }), titleSource: 'generated', firstPrompt: prompt }))
      .toBe('I want connect Mailchimp account using');
  });

  it.each([
    { title: 'My Own TITLE', titleSource: 'manual' as const, firstPrompt: 'Fix the login bug' },
    { title: 'A model chose this', titleSource: 'generated' as const, firstPrompt: 'Fix the login bug' },
    { title: 'Login Bug', titleSource: 'generated' as const },
    { title: 'Untitled', titleSource: 'fallback' as const, firstPrompt: 'Fix the login bug' },
    { title: null, titleSource: 'generated' as const, firstPrompt: 'Fix the login bug' },
  ])('keeps saved or unloaded titles verbatim: %j', input => {
    expect(conversationTitleForDisplay(input)).toBe(input.title);
  });
  it('strips leading filler and stop words, title-casing what is left', () => {
    // "of"/"the"/"in" dropped, as in Open Design's own UI. Deliberate divergence: Open Design
    // renders this as "Do You See All Files This", because its six-word cap lands mid-phrase and
    // strands the "This". We trim trailing function words, so the title ends on a content word.
    expect(deriveConversationTitle({ prompt: 'Do you see all of the files in this project?' })).toBe(
      'Do You See All Files',
    );
  });

  it('caps the length, because a six-WORD cap is not a length cap', () => {
    // A pasted blob is one enormous token, so it passed the word cap untouched and became the title
    // verbatim — then got stored and re-rendered on every conversation-list read.
    const blob = 'A'.repeat(500_000);
    const title = deriveConversationTitle({ prompt: blob });
    expect(title.length).toBeLessThanOrEqual(80);
    // Still a usable title rather than empty.
    expect(title.length).toBeGreaterThan(0);
  });

  it('does not end a title on a stranded auxiliary or pronoun', () => {
    // The word cap falls mid-clause on question-shaped prompts, which is how a real conversation
    // ended up titled "How Many Published Posts Do I" in the admin switcher.
    expect(deriveConversationTitle({ prompt: 'how many published posts do I have?' })).toBe(
      'How Many Published Posts',
    );
    // Trailing-only trimming must not touch a title that already ends on a content word.
    expect(deriveConversationTitle({ prompt: 'Fix the login bug' })).toBe('Login Bug');
  });

  it('drops a leading polite imperative', () => {
    expect(deriveConversationTitle({ prompt: 'Can you build a dashboard for signups' })).toBe('Dashboard Signups');
  });

  it('caps at six words so a long prompt cannot become a long row', () => {
    const title = deriveConversationTitle({ prompt: 'alpha bravo charlie delta echo foxtrot golf hotel india' });
    expect(title.split(' ')).toHaveLength(6);
  });

  it('stops at the first sentence rather than running two together', () => {
    expect(deriveConversationTitle({ prompt: 'Fix the login bug! Then deploy to staging.' })).toBe('Login Bug');
  });

  it('does NOT treat a period as a sentence break', () => {
    // Deliberate: periods appear in filenames and versions far more often than they end a
    // prompt's first clause. Splitting on '.' would title this conversation "App" and throw
    // away the only word that identifies it.
    expect(deriveConversationTitle({ prompt: 'Update app.tsx and the router' })).toBe('App Tsx Router');
  });

  it('ignores fenced code, inline code, URLs and handles', () => {
    expect(deriveConversationTitle({ prompt: '```ts\nconst x = 1\n```' })).toBe('');
    expect(deriveConversationTitle({ prompt: 'https://example.com/a/b/c' })).toBe('');
    expect(deriveConversationTitle({ prompt: '@alice #urgent' })).toBe('');
  });

  it('returns empty for input that yields nothing usable, rather than inventing a title', () => {
    // Callers render "Untitled" for '' — better than a row showing 400 characters of pasted code.
    expect(deriveConversationTitle({ prompt: '   ' })).toBe('');
    expect(deriveConversationTitle({ prompt: '!!!???' })).toBe('');
  });

  it('uses the CJK path, which caps by character and drops spacing', () => {
    const title = deriveConversationTitle({ prompt: '帮我做一个博客的搜索功能，然后再优化一下样式' });
    expect(title).not.toContain(' ');
    expect(title.length).toBeLessThanOrEqual(18);
    // Leading filler ("帮我做一个") is stripped, so the topic survives rather than the request verb.
    expect(title.startsWith('帮我')).toBe(false);
  });

  it('keeps the first clause when the prompt is a single long sentence', () => {
    expect(deriveConversationTitle({ prompt: 'implement the retention sweep for guest chats' })).toBe(
      'Retention Sweep Guest Chats',
    );
  });
});
