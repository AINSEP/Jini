import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_PUBLICATION_BLOCKED_CODE,
  ArtifactPublicationBlockedError,
  assertArtifactPublicationAllowed,
  buildArtifactPublicationBlockedMessage,
  emptyPublicationGuardConfig,
  findBlockedPlaceholders,
  isPublicationGuardedKind,
  shouldBlockPublication,
  type PublicationGuardConfig,
} from '../publication-guard.js';

const config: PublicationGuardConfig = {
  guardedKinds: new Set(['html', 'deck']),
  blockedPlaceholders: ['TODO_FILL_ME', '$X.XM'],
};

describe('isPublicationGuardedKind', () => {
  it('is true for a configured kind and false otherwise', () => {
    expect(isPublicationGuardedKind({ kind: 'html', config })).toBe(true);
    expect(isPublicationGuardedKind({ kind: 'markdown', config })).toBe(false);
    expect(isPublicationGuardedKind({ kind: 42, config })).toBe(false);
  });
});

describe('findBlockedPlaceholders / shouldBlockPublication', () => {
  it('finds configured placeholders in string content', () => {
    expect(findBlockedPlaceholders({ value: 'raise $X.XM today', config })).toEqual(['$X.XM']);
    expect(shouldBlockPublication({ value: 'raise $X.XM today', config })).toBe(true);
  });

  it('finds placeholders in Buffer and Uint8Array content', () => {
    expect(findBlockedPlaceholders({ value: Buffer.from('TODO_FILL_ME here'), config })).toEqual(['TODO_FILL_ME']);
    expect(findBlockedPlaceholders({ value: new TextEncoder().encode('TODO_FILL_ME here'), config })).toEqual(['TODO_FILL_ME']);
  });

  it('returns [] for content with no configured markers, or non-string/buffer content', () => {
    expect(findBlockedPlaceholders({ value: 'clean content', config })).toEqual([]);
    expect(shouldBlockPublication({ value: 'clean content', config })).toBe(false);
    expect(findBlockedPlaceholders({ value: 42, config })).toEqual([]);
    expect(findBlockedPlaceholders({ value: null, config })).toEqual([]);
  });

  it('returns every matching marker, not just the first', () => {
    expect(findBlockedPlaceholders({ value: 'TODO_FILL_ME and $X.XM both here', config })).toEqual(['TODO_FILL_ME', '$X.XM']);
  });
});

describe('buildArtifactPublicationBlockedMessage', () => {
  it('lists the placeholders', () => {
    expect(buildArtifactPublicationBlockedMessage({ placeholders: ['a', 'b'] })).toContain('a, b');
  });

  it('falls back to "unknown placeholders" for an empty list', () => {
    expect(buildArtifactPublicationBlockedMessage({ placeholders: [] })).toContain('unknown placeholders');
  });
});

describe('ArtifactPublicationBlockedError', () => {
  it('carries the code and placeholder list', () => {
    const err = new ArtifactPublicationBlockedError({ placeholders: ['a', 'b'] });
    expect(err.code).toBe(ARTIFACT_PUBLICATION_BLOCKED_CODE);
    expect(err.placeholders).toEqual(['a', 'b']);
    expect(err.name).toBe('ArtifactPublicationBlockedError');
  });
});

describe('assertArtifactPublicationAllowed', () => {
  it('throws for a guarded kind whose content has a blocked placeholder', () => {
    expect(() => assertArtifactPublicationAllowed({ kind: 'html', value: 'TODO_FILL_ME', config })).toThrow(
      ArtifactPublicationBlockedError,
    );
  });

  it('does not throw for a guarded kind with clean content', () => {
    expect(() => assertArtifactPublicationAllowed({ kind: 'html', value: 'all good', config })).not.toThrow();
  });

  it('does not throw for an unguarded kind, even with a blocked placeholder present', () => {
    expect(() => assertArtifactPublicationAllowed({ kind: 'markdown', value: 'TODO_FILL_ME', config })).not.toThrow();
  });

  it('the empty config guards nothing', () => {
    expect(() => assertArtifactPublicationAllowed({ kind: 'html', value: 'TODO_FILL_ME', config: emptyPublicationGuardConfig })).not.toThrow();
  });
});
