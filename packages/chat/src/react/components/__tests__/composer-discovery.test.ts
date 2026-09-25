import { afterEach, describe, expect, it } from 'vitest';
import type { ComposerDiscoveryGroup, ComposerDiscoveryItem } from '../../slots.js';
import {
  composerDiscoveryMenuPosition,
  composerSlashMenuPosition,
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

/**
 * Regression coverage for an owner-reported bug: the "+" discovery menu and the slash palette are
 * `position: absolute` descendants of `.jini-composer`, which sits inside `.jini-chat-pane__body`
 * — an ancestor that sets `overflow: hidden` unconditionally, plus whatever clipping box a host's
 * own dock chrome adds (a host admin's `.admin-chat-dock` is `overflow: hidden` too, and its mobile
 * "peek" sheet caps the whole dock at 58vh). CSS alone cannot know how much room that leaves above
 * the composer on a given host — when a popover's natural content is taller than the available
 * space, the ancestor's hard clip boundary sliced through whichever row sat at the clip line
 * instead of the popover's own internal scroll doing so, which read as "the list is clipped
 * mid-item at the top" rather than as a clean scroll boundary.
 *
 * `composerDiscoveryMenuPosition`/`composerSlashMenuPosition` fix this the same way
 * `useAgentRuntimePicker.hooks.ts`'s `runtimePopoverPosition('up', ...)` already fixes the
 * identical class of bug for the sibling runtime popover: `position: fixed`, computed from the
 * composer's live viewport rect, with `maxHeight` clamped to the space actually available above
 * it — so the popover escapes every ancestor's `overflow: hidden` regardless of host layout, and
 * degrades to an internal scroll (never a mid-row clip) when the composer sits close to the top of
 * a short viewport.
 */
describe('composerDiscoveryMenuPosition / composerSlashMenuPosition', () => {
  const originalInnerWidth = window.innerWidth;
  const originalInnerHeight = window.innerHeight;

  function stubViewport(width: number, height: number) {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
  }

  afterEach(() => {
    stubViewport(originalInnerWidth, originalInnerHeight);
  });

  it('discovery menu: always renders position: fixed, escaping any overflow: hidden ancestor', () => {
    stubViewport(1024, 768);
    const composerRect = { top: 600, left: 40, width: 320 };
    expect(composerDiscoveryMenuPosition(composerRect)).toMatchObject({
      position: 'fixed',
      zIndex: 8,
    });
  });

  it('discovery menu: keeps the reference stylesheet\'s left-aligned, width-capped footprint when there is ample room above the composer', () => {
    stubViewport(1024, 768);
    // Plenty of vertical room above `top: 600` in a 768px-tall viewport — the clamp should not
    // engage, so this must match the CSS default exactly: `inset-inline-start: 8px`,
    // `width: min(280px, 100vw - 32px)`, `bottom: calc(100% + 6px)`.
    const composerRect = { top: 600, left: 40, width: 320 };
    const position = composerDiscoveryMenuPosition(composerRect);
    expect(position.left).toBe(48); // composerRect.left (40) + 8px inset
    expect(position.width).toBe(280); // under the 1024 - 32 = 992px cap
    expect(position.bottom).toBe(768 - 600 + 6); // innerHeight - top + gap
    expect(position.maxHeight).toBe(280); // under the 600 - 6 - 8 = 586px available cap
  });

  it('discovery menu: clamps maxHeight to the space actually available above the composer instead of clipping into the ancestor', () => {
    // Reproduces a host admin's mobile "peek" sheet: a short dock where the composer sits close to
    // the sheet's own top edge. Available space above it is far under the CSS's flat 280px cap.
    stubViewport(400, 700);
    const composerRect = { top: 120, left: 8, width: 384 };
    const position = composerDiscoveryMenuPosition(composerRect);
    // 120 - 6 (gap) - 8 (margin) = 106px available — must clamp below the 280px default, not
    // render a 280px-tall box that the ancestor then has to hard-clip.
    expect(position.maxHeight).toBe(106);
    expect(position.maxHeight).toBeLessThan(280);
  });

  it('discovery menu: never asks for a negative maxHeight when the composer has no room above it at all', () => {
    stubViewport(400, 700);
    const composerRect = { top: 4, left: 8, width: 384 };
    expect(composerDiscoveryMenuPosition(composerRect).maxHeight).toBe(0);
  });

  it('slash palette: always renders position: fixed and spans the composer width minus its 8px insets', () => {
    stubViewport(1024, 768);
    const composerRect = { top: 600, left: 40, width: 320 };
    const position = composerSlashMenuPosition(composerRect);
    expect(position.position).toBe('fixed');
    expect(position.left).toBe(48); // composerRect.left (40) + 8px inset
    expect(position.width).toBe(304); // composerRect.width (320) - 2 * 8px inset
  });

  it('slash palette: clamps maxHeight the same way the discovery menu does', () => {
    stubViewport(400, 700);
    const composerRect = { top: 120, left: 8, width: 384 };
    expect(composerSlashMenuPosition(composerRect).maxHeight).toBe(106);
  });
});
