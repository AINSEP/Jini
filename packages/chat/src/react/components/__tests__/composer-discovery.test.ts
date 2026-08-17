import { describe, expect, it } from 'vitest';
import type { ComposerDiscoveryGroup, ComposerDiscoveryItem } from '../../slots.js';
import {
  filterComposerDiscovery,
  parseComposerSlashQuery,
  resolveComposerSlashInvocation,
} from '../composer-discovery.js';

/**
 * Regression coverage for the argument grammar added to serve debate 2 ("Composer slash
 * commands", ADS-memory/reports/swarm-consensus/runs/2026-08-12-tovu-six-debates-FINAL.md §2).
 * `Composer.test.tsx` already exercises the integrated keyboard/select flow through these
 * functions; this file isolates the pure parser/filter contract so the argument grammar and the
 * exact-match-after-separator rule are provable without a DOM.
 */
describe('parseComposerSlashQuery', () => {
  it('returns null for a non-trigger draft', () => {
    expect(parseComposerSlashQuery('hello')).toBeNull();
    expect(parseComposerSlashQuery('')).toBeNull();
  });

  it('parses a bare command with no separator typed yet', () => {
    expect(parseComposerSlashQuery('/mcp')).toEqual({ command: 'mcp', argument: null });
  });

  it('commits to a command the instant a trailing space is typed, argument becomes empty string', () => {
    expect(parseComposerSlashQuery('/mcp ')).toEqual({ command: 'mcp', argument: '' });
  });

  it('captures a multi-word argument verbatim, including internal spaces and slashes', () => {
    expect(parseComposerSlashQuery('/search site:example.com/a/b open design')).toEqual({
      command: 'search',
      argument: 'site:example.com/a/b open design',
    });
  });

  it('stays anchored end-to-end: a second slash in the command position is rejected', () => {
    expect(parseComposerSlashQuery('/mc/p')).toBeNull();
  });

  it('stays anchored end-to-end: text before the leading slash is rejected', () => {
    expect(parseComposerSlashQuery('hi /mcp')).toBeNull();
  });

  it('parses the bare-slash empty command (the existing zero-query behavior)', () => {
    expect(parseComposerSlashQuery('/')).toEqual({ command: '', argument: null });
  });
});

describe('filterComposerDiscovery', () => {
  const groups: ComposerDiscoveryGroup[] = [
    {
      id: 'commands',
      label: 'Commands',
      items: [
        { id: 'mcp', label: '/mcp', command: 'mcp', keywords: ['mcp', 'server'] },
        { id: 'mcp-docs', label: '/mcp-docs', command: 'mcp-docs', keywords: ['mcp-docs', 'mcp', 'docs'] },
        { id: 'word-count', label: 'Word Count', kind: 'plugin', keywords: ['plugin', 'content'] },
      ],
    },
  ];

  it('fuzzy-matches every item, command-bearing or not, while the command word is still being typed', () => {
    const query = parseComposerSlashQuery('/mcp')!;
    expect(filterComposerDiscovery(groups, query).map((m) => m.item.id).sort()).toEqual(['mcp', 'mcp-docs']);
  });

  it('shows everything on a bare slash, matching the existing zero-query behavior', () => {
    const query = parseComposerSlashQuery('/')!;
    expect(filterComposerDiscovery(groups, query).map((m) => m.item.id)).toEqual(['mcp', 'mcp-docs', 'word-count']);
  });

  it(
    'narrows to the exact command the instant an argument separator is typed, even though ' +
      '"mcp" is a substring of "mcp-docs" (regression: a fuzzy match here could hand a typed ' +
      'argument to the wrong item)',
    () => {
      const query = parseComposerSlashQuery('/mcp supabase')!;
      expect(filterComposerDiscovery(groups, query).map((m) => m.item.id)).toEqual(['mcp']);
    },
  );

  it('drops every command-less item once an argument separator is typed — they cannot take one', () => {
    const query = parseComposerSlashQuery('/word count')!;
    expect(filterComposerDiscovery(groups, query)).toEqual([]);
  });

  it('is case-insensitive on the command word', () => {
    const query = parseComposerSlashQuery('/MCP supabase')!;
    expect(filterComposerDiscovery(groups, query).map((m) => m.item.id)).toEqual(['mcp']);
  });
});

describe('resolveComposerSlashInvocation', () => {
  const plainItem: ComposerDiscoveryItem = { id: 'ux', label: 'UI/UX Design', insertText: 'UI/UX Design skill' };
  const noArgCommand: ComposerDiscoveryItem = { id: 'mcp', label: '/mcp', command: 'mcp' };
  const optionalArgCommand: ComposerDiscoveryItem = {
    id: 'mcp-arg',
    label: '/mcp',
    command: 'mcp',
    argument: { placeholder: '<server-id>' },
  };
  const requiredArgCommand: ComposerDiscoveryItem = {
    id: 'search',
    label: '/search',
    command: 'search',
    argument: { placeholder: '<query>', required: true },
  };

  it('a plain item (no command) always invokes, unaffected by the argument grammar', () => {
    expect(resolveComposerSlashInvocation('/ux', plainItem)).toEqual({ type: 'invoke' });
  });

  it('returns null for a draft the parser itself rejects', () => {
    expect(resolveComposerSlashInvocation('hello', plainItem)).toBeNull();
  });

  it('completes a fuzzy/prefix match to the exact command word rather than guessing', () => {
    expect(resolveComposerSlashInvocation('/mc', noArgCommand)).toEqual({ type: 'complete', draft: '/mcp' });
  });

  it('invokes a no-argument command the instant its exact word is typed, with no separator required', () => {
    expect(resolveComposerSlashInvocation('/mcp', noArgCommand)).toEqual({ type: 'invoke', argument: null });
  });

  it('completes (does not invoke) an argument-taking command until a separator is typed', () => {
    expect(resolveComposerSlashInvocation('/mcp', optionalArgCommand)).toEqual({ type: 'complete', draft: '/mcp ' });
  });

  it('invokes an optional-argument command with argument "" once a bare separator is typed', () => {
    expect(resolveComposerSlashInvocation('/mcp ', optionalArgCommand)).toEqual({ type: 'invoke', argument: '' });
  });

  it('invokes an optional-argument command with the typed value once one is present', () => {
    expect(resolveComposerSlashInvocation('/mcp supabase', optionalArgCommand)).toEqual({
      type: 'invoke',
      argument: 'supabase',
    });
  });

  it('never invokes a required-argument command with a missing or blank argument', () => {
    expect(resolveComposerSlashInvocation('/search', requiredArgCommand)).toEqual({
      type: 'complete',
      draft: '/search ',
    });
    expect(resolveComposerSlashInvocation('/search ', requiredArgCommand)).toEqual({
      type: 'complete',
      draft: '/search ',
    });
    expect(resolveComposerSlashInvocation('/search   ', requiredArgCommand)).toEqual({
      type: 'complete',
      draft: '/search ',
    });
  });

  it('invokes a required-argument command once non-blank text follows the separator', () => {
    expect(resolveComposerSlashInvocation('/search open design composer', requiredArgCommand)).toEqual({
      type: 'invoke',
      argument: 'open design composer',
    });
  });

  it('preserves internal whitespace/slashes in the argument verbatim', () => {
    expect(resolveComposerSlashInvocation('/search site:example.com/a/b', requiredArgCommand)).toEqual({
      type: 'invoke',
      argument: 'site:example.com/a/b',
    });
  });
});
