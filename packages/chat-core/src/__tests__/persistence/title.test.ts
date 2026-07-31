/**
 * `deriveConversationTitle` — the no-model, no-latency title a conversation gets the instant it
 * appears in a list.
 *
 * The cases below are the ones that made the original heuristic worth porting rather than
 * replacing with `prompt.slice(0, 40)`: filler stripping, stop-word removal, and the refusal to
 * title a conversation after a pasted URL or code block.
 */
import { describe, expect, it } from 'vitest';

import { deriveConversationTitle } from '../../persistence/title.js';

describe('deriveConversationTitle', () => {
  it('strips leading filler and stop words, title-casing what is left', () => {
    // "of"/"the"/"in" dropped, as in Open Design's own UI. Deliberate divergence: Open Design
    // renders this as "Do You See All Files This", because its six-word cap lands mid-phrase and
    // strands the "This". We trim trailing function words, so the title ends on a content word.
    expect(deriveConversationTitle('Do you see all of the files in this project?')).toBe(
      'Do You See All Files',
    );
  });

  it('does not end a title on a stranded auxiliary or pronoun', () => {
    // The word cap falls mid-clause on question-shaped prompts, which is how a real conversation
    // ended up titled "How Many Published Posts Do I" in the admin switcher.
    expect(deriveConversationTitle('how many published posts do I have?')).toBe(
      'How Many Published Posts',
    );
    // Trailing-only trimming must not touch a title that already ends on a content word.
    expect(deriveConversationTitle('Fix the login bug')).toBe('Login Bug');
  });

  it('drops a leading polite imperative', () => {
    expect(deriveConversationTitle('Can you build a dashboard for signups')).toBe('Dashboard Signups');
  });

  it('caps at six words so a long prompt cannot become a long row', () => {
    const title = deriveConversationTitle('alpha bravo charlie delta echo foxtrot golf hotel india');
    expect(title.split(' ')).toHaveLength(6);
  });

  it('stops at the first sentence rather than running two together', () => {
    expect(deriveConversationTitle('Fix the login bug! Then deploy to staging.')).toBe('Login Bug');
  });

  it('does NOT treat a period as a sentence break', () => {
    // Deliberate: periods appear in filenames and versions far more often than they end a
    // prompt's first clause. Splitting on '.' would title this conversation "App" and throw
    // away the only word that identifies it.
    expect(deriveConversationTitle('Update app.tsx and the router')).toBe('App Tsx Router');
  });

  it('ignores fenced code, inline code, URLs and handles', () => {
    expect(deriveConversationTitle('```ts\nconst x = 1\n```')).toBe('');
    expect(deriveConversationTitle('https://example.com/a/b/c')).toBe('');
    expect(deriveConversationTitle('@alice #urgent')).toBe('');
  });

  it('returns empty for input that yields nothing usable, rather than inventing a title', () => {
    // Callers render "Untitled" for '' — better than a row showing 400 characters of pasted code.
    expect(deriveConversationTitle('   ')).toBe('');
    expect(deriveConversationTitle('!!!???')).toBe('');
  });

  it('uses the CJK path, which caps by character and drops spacing', () => {
    const title = deriveConversationTitle('帮我做一个博客的搜索功能，然后再优化一下样式');
    expect(title).not.toContain(' ');
    expect(title.length).toBeLessThanOrEqual(18);
    // Leading filler ("帮我做一个") is stripped, so the topic survives rather than the request verb.
    expect(title.startsWith('帮我')).toBe(false);
  });

  it('keeps the first clause when the prompt is a single long sentence', () => {
    expect(deriveConversationTitle('implement the retention sweep for guest chats')).toBe(
      'Retention Sweep Guest Chats',
    );
  });
});
