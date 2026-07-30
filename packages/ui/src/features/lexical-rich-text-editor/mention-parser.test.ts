import { describe, expect, it } from 'vitest';
import {
  buildMentionToken,
  foldPresentMentions,
  isMentionBoundary,
  isMentionRightBoundary,
  mentionTokenPresent,
  parseMentionParts,
} from './mention-parser.js';
import type { MentionEntity } from './types.js';

const slack: MentionEntity = { id: 'slack', kind: 'connector', label: 'Slack' };
const slackBot: MentionEntity = { id: 'slack-bot', kind: 'connector', label: 'SlackBot' };
const notion: MentionEntity = { id: 'notion', kind: 'connector', label: 'Notion' };

describe('buildMentionToken', () => {
  it('prefixes a bare label with @', () => {
    expect(buildMentionToken('Slack')).toBe('@Slack');
  });

  it('leaves an already-prefixed label alone', () => {
    expect(buildMentionToken('@Slack')).toBe('@Slack');
  });
});

describe('isMentionBoundary', () => {
  it('is true at the start of the string', () => {
    expect(isMentionBoundary('@Slack', 0)).toBe(true);
  });

  it('is true after whitespace', () => {
    expect(isMentionBoundary('hi @Slack', 3)).toBe(true);
  });

  it.each(['(', '[', '{', '"', "'"])('is true after an opening %s', (char) => {
    const text = `${char}@Slack`;
    expect(isMentionBoundary(text, 1)).toBe(true);
  });

  it('is false mid-word', () => {
    expect(isMentionBoundary('foo@Slack', 3)).toBe(false);
  });
});

describe('isMentionRightBoundary', () => {
  it('is true at end of string', () => {
    expect(isMentionRightBoundary('@Slack', 6)).toBe(true);
  });

  it('is true before whitespace or @', () => {
    expect(isMentionRightBoundary('@Slack more', 6)).toBe(true);
    expect(isMentionRightBoundary('@Slack@Notion', 6)).toBe(true);
  });

  it('is false before a letter', () => {
    expect(isMentionRightBoundary('@Slackish', 6)).toBe(false);
  });
});

describe('parseMentionParts', () => {
  it('returns null for empty text', () => {
    expect(parseMentionParts('', [slack])).toBeNull();
  });

  it('returns null when there is no @ at all', () => {
    expect(parseMentionParts('hello world', [slack])).toBeNull();
  });

  it('returns null when @ is present but matches nothing (no known, no unknown-highlight)', () => {
    expect(parseMentionParts('a@b', [slack])).toBeNull();
  });

  it('parses a single known mention with surrounding text', () => {
    const parts = parseMentionParts('hi @Slack there', [slack]);
    expect(parts).toEqual([
      { kind: 'text', text: 'hi ' },
      { kind: 'mention', entity: expect.objectContaining({ id: 'slack' }), text: '@Slack' },
      { kind: 'text', text: ' there' },
    ]);
  });

  it('picks the longest known match at a given start (trie longest-match)', () => {
    const parts = parseMentionParts('@SlackBot', [slack, slackBot]);
    expect(parts).toEqual([
      { kind: 'mention', entity: expect.objectContaining({ id: 'slack-bot' }), text: '@SlackBot' },
    ]);
  });

  it('prefers a longer unknown match over a shorter known match', () => {
    // "@Slackish" is not a known token, but "@Slack" is — since it's not a
    // right-boundary match for the known token (the following "ish" fails
    // isMentionRightBoundary), the whole run should fall through to the
    // unknown-mention regex instead.
    const parts = parseMentionParts('@Slackish', [slack], { highlightUnknown: true });
    expect(parts).toEqual([
      {
        kind: 'mention',
        entity: expect.objectContaining({ id: 'unknown:@Slackish', kind: 'unknown' }),
        text: '@Slackish',
      },
    ]);
  });

  it('does not treat a bare @ immediately followed by whitespace as an unknown mention', () => {
    expect(parseMentionParts('@ hello', [], { highlightUnknown: true })).toBeNull();
  });

  it('does not treat a bare trailing @ as an unknown mention', () => {
    expect(parseMentionParts('hi @', [], { highlightUnknown: true })).toBeNull();
  });

  it('does not highlight unknown mentions when highlightUnknown is false', () => {
    expect(parseMentionParts('@Slackish', [slack], { highlightUnknown: false })).toBeNull();
  });

  it('skips a non-boundary @ (mid-word) and continues scanning', () => {
    const parts = parseMentionParts('foo@bar @Slack', [slack], { highlightUnknown: false });
    expect(parts).toEqual([
      { kind: 'text', text: 'foo@bar ' },
      { kind: 'mention', entity: expect.objectContaining({ id: 'slack' }), text: '@Slack' },
    ]);
  });

  it('interleaves text and mention parts for two space-separated mentions', () => {
    const parts = parseMentionParts('@Slack @Notion', [slack, notion]);
    expect(parts).toEqual([
      { kind: 'mention', entity: expect.objectContaining({ id: 'slack' }), text: '@Slack' },
      { kind: 'text', text: ' ' },
      { kind: 'mention', entity: expect.objectContaining({ id: 'notion' }), text: '@Notion' },
    ]);
  });

  it('does not treat a second @ immediately after a mention as its own boundary', () => {
    // "@Notion" starts right after "Slack" with no whitespace between them —
    // isMentionBoundary requires whitespace/start/bracket before "@", so the
    // second "@" is swallowed into the trailing text run rather than parsed
    // as a second mention.
    const parts = parseMentionParts('@Slack@Notion', [slack, notion], { highlightUnknown: false });
    expect(parts).toEqual([
      { kind: 'mention', entity: expect.objectContaining({ id: 'slack' }), text: '@Slack' },
      { kind: 'text', text: '@Notion' },
    ]);
  });

  it('appends a trailing text run after the last match', () => {
    const parts = parseMentionParts('@Slack tail', [slack]);
    expect(parts?.at(-1)).toEqual({ kind: 'text', text: ' tail' });
  });

  it('reuses the cached trie for the same entities array reference', () => {
    const entities = [slack, notion];
    const first = parseMentionParts('@Slack', entities);
    const second = parseMentionParts('@Notion', entities);
    expect(first?.[0]).toMatchObject({ entity: { id: 'slack' } });
    expect(second?.[0]).toMatchObject({ entity: { id: 'notion' } });
  });

  it('deduplicates entities with the same kind:token and skips a bare "@"', () => {
    const bare: MentionEntity = { id: 'bare', kind: 'x', label: '', token: '@' };
    const dup: MentionEntity = { id: 'slack-dup', kind: 'connector', label: 'Slack' };
    const parts = parseMentionParts('@Slack', [slack, dup, bare]);
    // Whichever of slack/dup was inserted first in the normalized+sorted
    // list wins; either is a correct, deterministic single match.
    expect(parts).toHaveLength(1);
    expect(parts?.[0]).toMatchObject({ kind: 'mention', text: '@Slack' });
  });

  it('carries an entity.title through the normalized trie entry into the matched part', () => {
    const titled: MentionEntity = {
      id: 'slack',
      kind: 'connector',
      label: 'Slack',
      title: 'Slack workspace',
    };
    const parts = parseMentionParts('@Slack', [titled]);
    expect(parts).toEqual([
      {
        kind: 'mention',
        entity: expect.objectContaining({ id: 'slack', title: 'Slack workspace' }),
        text: '@Slack',
      },
    ]);
  });

  it('omits title from the matched entity when the source entity has none', () => {
    const parts = parseMentionParts('@Slack', [slack]);
    expect(parts?.[0]).toMatchObject({ kind: 'mention' });
    const matched = parts?.[0];
    expect(matched && matched.kind === 'mention' ? matched.entity.title : undefined).toBeUndefined();
  });

  it('uses an explicit entity.token over a derived one', () => {
    const custom: MentionEntity = { id: 'x', kind: 'file', label: 'readme', token: '@README' };
    const parts = parseMentionParts('@README', [custom]);
    expect(parts).toEqual([
      { kind: 'mention', entity: expect.objectContaining({ id: 'x' }), text: '@README' },
    ]);
  });
});

describe('mentionTokenPresent', () => {
  it('finds a standalone mention', () => {
    expect(mentionTokenPresent('hi @Slack there', 'Slack')).toBe(true);
  });

  it('is false when the label never appears', () => {
    expect(mentionTokenPresent('hi there', 'Slack')).toBe(false);
  });

  it('is false for a substring occurrence of a longer word', () => {
    expect(mentionTokenPresent('@Slackish', 'Slack')).toBe(false);
  });

  it('tolerates trailing punctuation right after the pill (looser than parse boundary)', () => {
    expect(mentionTokenPresent('ping @Slack, now', 'Slack')).toBe(true);
    expect(mentionTokenPresent('ping @Slack.', 'Slack')).toBe(true);
  });

  it('skips a non-left-boundary occurrence and keeps scanning for a real one', () => {
    expect(mentionTokenPresent('x@Slack and also @Slack', 'Slack')).toBe(true);
  });
});

describe('foldPresentMentions', () => {
  it('returns present unchanged when there is no plain-text @ match', () => {
    const result = foldPresentMentions('no mentions here', [], [slack]);
    expect(result).toEqual([]);
  });

  it('folds a plain-text @token matching a known entity into present', () => {
    const result = foldPresentMentions('hi @Slack', [], [slack]);
    expect(result).toEqual([expect.objectContaining({ id: 'slack' })]);
  });

  it('does not duplicate an entity already in present', () => {
    const result = foldPresentMentions('hi @Slack', [slack], [slack]);
    expect(result).toEqual([slack]);
  });

  it('does not fold an unknown mention', () => {
    const result = foldPresentMentions('hi @Ghost', [], []);
    expect(result).toEqual([]);
  });
});
