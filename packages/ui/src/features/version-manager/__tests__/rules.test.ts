import { describe, expect, it } from 'vitest';
import type { ViewportPreset } from '../../viewer-shell/index.js';
import {
  buildVersionIndex,
  contentMatchesSelection,
  effectivePreviewScale,
  filterVersionsBySearch,
  findViewportPreset,
  formatVersionDateTime,
  isRestoreDisabled,
  previewScaleShellStyle,
  previewViewportStyle,
  resolveSelectedVersion,
  restoredFromVersion,
  shouldShowVersionSearch,
  sortVersionsDescending,
  versionSourceClassName,
  versionSourceLabel,
} from '../rules.js';
import type { VersionRecord } from '../types.js';

function makeVersion(overrides: Partial<VersionRecord> & { id: string; version: number }): VersionRecord {
  return {
    createdAt: 0,
    current: false,
    source: 'ai',
    ...overrides,
  };
}

describe('formatVersionDateTime', () => {
  it('formats a valid timestamp with the given locale', () => {
    const formatted = formatVersionDateTime({ value: Date.UTC(2026, 0, 15, 10, 30), locale: 'en-US' });
    expect(formatted).toMatch(/Jan/);
  });

  it('falls back to Date.now() for an undefined value', () => {
    expect(formatVersionDateTime({ value: undefined, locale: 'en-US' })).toEqual(expect.any(String));
  });

  it('falls back to default locale formatting when the locale tag is invalid', () => {
    const formatted = formatVersionDateTime({ value: Date.UTC(2026, 0, 15), locale: 'this is not a locale!!' });
    expect(typeof formatted).toBe('string');
    expect(formatted.length).toBeGreaterThan(0);
  });
});

describe('versionSourceLabel / versionSourceClassName', () => {
  it.each([
    ['manual', 'Manual', 'manual'],
    ['restore', 'Restored', 'restore'],
    ['ai', 'AI generated', 'ai'],
  ] as const)('maps %s to label/class', (source, label, className) => {
    expect(versionSourceLabel({ source })).toBe(label);
    expect(versionSourceClassName({ source })).toBe(className);
  });
});

describe('sortVersionsDescending', () => {
  it('sorts newest-version-first without mutating the input', () => {
    const input = [makeVersion({ id: 'a', version: 1 }), makeVersion({ id: 'b', version: 3 }), makeVersion({ id: 'c', version: 2 })];
    const sorted = sortVersionsDescending(input);
    expect(sorted.map((v) => v.version)).toEqual([3, 2, 1]);
    expect(input.map((v) => v.version)).toEqual([1, 3, 2]);
  });
});

describe('buildVersionIndex', () => {
  it('indexes versions by id', () => {
    const versions = [makeVersion({ id: 'a', version: 1 }), makeVersion({ id: 'b', version: 2 })];
    const index = buildVersionIndex(versions);
    expect(index.get('a')?.version).toBe(1);
    expect(index.get('missing')).toBeUndefined();
  });
});

describe('restoredFromVersion', () => {
  const versions = [makeVersion({ id: 'a', version: 1 }), makeVersion({ id: 'b', version: 2, restoreFromVersionId: 'a' })];
  const index = buildVersionIndex(versions);

  it('resolves the version a restore came from', () => {
    expect(restoredFromVersion({ version: versions[1], versionById: index })?.id).toBe('a');
  });

  it('returns null when there is no restoreFromVersionId', () => {
    expect(restoredFromVersion({ version: versions[0], versionById: index })).toBeNull();
  });

  it('returns null when the referenced version is no longer present', () => {
    expect(restoredFromVersion({ version: makeVersion({ id: 'c', version: 3, restoreFromVersionId: 'ghost' }), versionById: index })).toBeNull();
  });

  it('returns null for a null/undefined version', () => {
    expect(restoredFromVersion({ version: null, versionById: index })).toBeNull();
    expect(restoredFromVersion({ version: undefined, versionById: index })).toBeNull();
  });
});

describe('resolveSelectedVersion', () => {
  const versions = [
    makeVersion({ id: 'a', version: 3, current: true }),
    makeVersion({ id: 'b', version: 2 }),
    makeVersion({ id: 'c', version: 1 }),
  ];
  const index = buildVersionIndex(versions);

  it('prefers an explicit selection when present', () => {
    expect(resolveSelectedVersion({ versions, versionById: index, selectedId: 'b' })?.id).toBe('b');
  });

  it('falls back to the current version when the selection is missing', () => {
    expect(resolveSelectedVersion({ versions, versionById: index, selectedId: 'ghost' })?.id).toBe('a');
  });

  it('falls back to current when selectedId is null', () => {
    expect(resolveSelectedVersion({ versions, versionById: index, selectedId: null })?.id).toBe('a');
  });

  it('falls back to the first version when none is current', () => {
    const noCurrent = versions.map((v) => ({ ...v, current: false }));
    expect(resolveSelectedVersion({ versions: noCurrent, versionById: buildVersionIndex(noCurrent), selectedId: null })?.id).toBe('a');
  });

  it('returns null for an empty list', () => {
    expect(resolveSelectedVersion({ versions: [], versionById: new Map(), selectedId: null })).toBeNull();
  });
});

describe('shouldShowVersionSearch', () => {
  it('is false at or below the threshold, true above it', () => {
    expect(shouldShowVersionSearch({ versionCount: 3, threshold: 3 })).toBe(false);
    expect(shouldShowVersionSearch({ versionCount: 4, threshold: 3 })).toBe(true);
    expect(shouldShowVersionSearch({ versionCount: 0, threshold: 3 })).toBe(false);
  });
});

describe('filterVersionsBySearch', () => {
  const versions = [
    makeVersion({ id: 'a', version: 1, label: 'Homepage draft' }),
    makeVersion({ id: 'b', version: 2, prompt: 'add a footer' }),
  ];

  it('returns all versions unchanged for an empty/whitespace search', () => {
    expect(filterVersionsBySearch({ versions, search: '', describe: () => 'anything' })).toEqual(versions);
    expect(filterVersionsBySearch({ versions, search: '   ', describe: () => 'anything' })).toEqual(versions);
  });

  it('filters case-insensitively against the describe callback', () => {
    const result = filterVersionsBySearch({ versions, search: 'FOOTER', describe: (v) => `${v.label ?? ''} ${v.prompt ?? ''}` });
    expect(result.map((v) => v.id)).toEqual(['b']);
  });

  it('returns an empty array when nothing matches', () => {
    expect(filterVersionsBySearch({ versions, search: 'zzz-no-match', describe: (v) => v.label ?? '' })).toEqual([]);
  });
});

describe('isRestoreDisabled', () => {
  const base = {
    selectedVersion: makeVersion({ id: 'a', version: 1, current: false }),
    restoring: false,
    loadingContent: false,
    selectedContentMatchesVersion: true,
  };

  it('is false when every condition allows restoring', () => {
    expect(isRestoreDisabled(base)).toBe(false);
  });

  it('is true with no selected version', () => {
    expect(isRestoreDisabled({ ...base, selectedVersion: null })).toBe(true);
  });

  it('is true when the selected version is already current', () => {
    expect(isRestoreDisabled({ ...base, selectedVersion: { ...base.selectedVersion, current: true } })).toBe(true);
  });

  it('is true while restoring', () => {
    expect(isRestoreDisabled({ ...base, restoring: true })).toBe(true);
  });

  it('is true while loading content', () => {
    expect(isRestoreDisabled({ ...base, loadingContent: true })).toBe(true);
  });

  it('is true when content does not match the selection', () => {
    expect(isRestoreDisabled({ ...base, selectedContentMatchesVersion: false })).toBe(true);
  });
});

describe('contentMatchesSelection', () => {
  it('is true only when id, content version id, and content all line up', () => {
    expect(contentMatchesSelection({ selectedId: 'a', selectedContentVersionId: 'a', selectedContent: 'body' })).toBe(true);
  });

  it('is false when selectedId is null', () => {
    expect(contentMatchesSelection({ selectedId: null, selectedContentVersionId: 'a', selectedContent: 'body' })).toBe(false);
  });

  it('is false when the content version id does not match', () => {
    expect(contentMatchesSelection({ selectedId: 'a', selectedContentVersionId: 'b', selectedContent: 'body' })).toBe(false);
  });

  it('is false when content is null', () => {
    expect(contentMatchesSelection({ selectedId: 'a', selectedContentVersionId: 'a', selectedContent: null })).toBe(false);
  });
});

const PRESETS: ViewportPreset[] = [
  { id: 'desktop', label: 'Desktop', width: null, height: null },
  { id: 'tablet', label: 'Tablet', width: 820, height: 1180 },
  { id: 'mobile', label: 'Mobile', width: 390, height: 844 },
];

describe('findViewportPreset', () => {
  it('finds a preset by id', () => {
    expect(findViewportPreset({ presets: PRESETS, id: 'tablet' })?.id).toBe('tablet');
  });

  it('falls back to the first preset for an unknown id', () => {
    expect(findViewportPreset({ presets: PRESETS, id: 'ghost' })?.id).toBe('desktop');
  });
});

describe('effectivePreviewScale', () => {
  it('returns previewScale unchanged for a "no fixed frame" preset', () => {
    expect(effectivePreviewScale({ preset: PRESETS[0]!, previewScale: 1, canvasSize: { width: 100, height: 100 }, canvasPadding: 48 })).toBe(1);
  });

  it('returns previewScale unchanged when canvasSize is missing', () => {
    expect(effectivePreviewScale({ preset: PRESETS[1]!, previewScale: 1, canvasSize: undefined, canvasPadding: 48 })).toBe(1);
  });

  it('returns previewScale unchanged when canvasSize has a zero dimension', () => {
    expect(effectivePreviewScale({ preset: PRESETS[1]!, previewScale: 1, canvasSize: { width: 0, height: 500 }, canvasPadding: 48 })).toBe(1);
  });

  it('scales down to fit a smaller canvas', () => {
    // tablet preset is 820x1180; a 400x1180 canvas with 48px padding can
    // only fit (400-48)/820 ≈ 0.4293 width-wise, which is the binding constraint.
    const scale = effectivePreviewScale({ preset: PRESETS[1]!, previewScale: 1, canvasSize: { width: 400, height: 1180 }, canvasPadding: 48 });
    expect(scale).toBeCloseTo((400 - 48) / 820, 4);
  });

  it('never scales up beyond the requested previewScale', () => {
    const scale = effectivePreviewScale({ preset: PRESETS[1]!, previewScale: 0.5, canvasSize: { width: 4000, height: 4000 }, canvasPadding: 48 });
    expect(scale).toBe(0.5);
  });
});

describe('previewViewportStyle', () => {
  it('returns an empty object for a "no fixed frame" preset', () => {
    expect(previewViewportStyle({ preset: PRESETS[0]!, effectiveScale: 1, previewScale: 1 })).toEqual({});
  });

  it('returns CSS custom properties for a fixed-size preset', () => {
    const style = previewViewportStyle({ preset: PRESETS[1]!, effectiveScale: 0.5, previewScale: 1 });
    expect(style).toEqual({
      '--preview-viewport-width': '820px',
      '--preview-viewport-height': '1180px',
      '--preview-scale': 0.5,
      '--preview-user-scale': 1,
    });
  });
});

describe('previewScaleShellStyle', () => {
  it('scales the whole shell for a "no fixed frame" preset', () => {
    const style = previewScaleShellStyle({ preset: PRESETS[0]!, previewScale: 0.5 });
    expect(style).toEqual({
      width: '200%',
      height: '200%',
      transform: 'scale(0.5)',
      transformOrigin: '0 0',
    });
  });

  it('sizes to the CSS custom properties for a fixed-size preset', () => {
    const style = previewScaleShellStyle({ preset: PRESETS[1]!, previewScale: 1 });
    expect(style).toEqual({
      width: 'var(--preview-viewport-width)',
      height: 'var(--preview-viewport-height)',
      transform: 'scale(var(--preview-scale, 1))',
      transformOrigin: '0 0',
    });
  });
});
