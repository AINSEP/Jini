import { describe, expect, it } from 'vitest';
import {
  buildInitialData,
  buildSketchTooltipLabels,
  cloneJson,
  defaultExcalidrawLangCode,
  emptySketchScene,
  exportedImageFileName,
  exportedImageResultFileName,
  isExcalidrawUnableToEmbedToast,
  isNonDeletedExcalidrawElement,
  normalizeTooltipLabel,
  orderContextMenuActions,
  resolveDefaultSketchToolColor,
  sanitizeExcalidrawAppState,
  sceneContentSignature,
  sceneFromExcalidraw,
  sketchSceneHasContent,
  translateDomTextValue,
  validateSketchEmbeddableUrl,
} from '../rules.js';

describe('cloneJson', () => {
  it('deep-clones a JSON-serializable value', () => {
    const value = { a: [1, 2, { b: 'c' }] };
    const cloned = cloneJson({ value, fallback: null });
    expect(cloned).toEqual(value);
    expect(cloned).not.toBe(value);
  });

  it('falls back when the value is not JSON-serializable (e.g. circular)', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(cloneJson({ value: circular, fallback: 'fallback' })).toBe('fallback');
  });
});

describe('sanitizeExcalidrawAppState', () => {
  it('strips transient/session-only fields', () => {
    const sanitized = sanitizeExcalidrawAppState({ value: {
      viewBackgroundColor: '#fff',
      openDialog: { name: 'help' },
      collaborators: new Map(),
      selectionElement: {},
    } });
    expect(sanitized).toEqual({ viewBackgroundColor: '#fff' });
  });

  it('handles null input', () => {
    expect(sanitizeExcalidrawAppState({ value: null })).toEqual({});
  });
});

describe('emptySketchScene / sketchSceneHasContent', () => {
  it('an empty scene has no content', () => {
    expect(sketchSceneHasContent({ scene: emptySketchScene({}, { name: 'a.png' }) })).toBe(false);
  });

  it('null/undefined scenes have no content', () => {
    expect(sketchSceneHasContent({ scene: null })).toBe(false);
    expect(sketchSceneHasContent({ scene: undefined })).toBe(false);
  });

  it('a scene with a non-deleted element has content', () => {
    expect(sketchSceneHasContent({ scene: { elements: [{ isDeleted: false }], appState: null, files: {} } })).toBe(true);
  });

  it('a scene with only deleted elements has no content', () => {
    expect(sketchSceneHasContent({ scene: { elements: [{ isDeleted: true }], appState: null, files: {} } })).toBe(false);
  });

  it('skips non-object entries in the elements array', () => {
    expect(sketchSceneHasContent({ scene: { elements: [null, 'x', 42], appState: null, files: {} } })).toBe(false);
  });
});

describe('buildInitialData', () => {
  it('carries elements/files through and applies the default stroke color', () => {
    const scene = { elements: [{ id: '1' }], appState: { viewBackgroundColor: '#123456' }, files: { f1: {} } };
    const data = buildInitialData({ scene, fileName: 'diagram.excalidraw', defaultStrokeColor: '#abcdef' });
    expect(data.elements).toEqual(scene.elements);
    expect(data.files).toEqual(scene.files);
    expect(data.appState.name).toBe('diagram.excalidraw');
    expect(data.appState.currentItemStrokeColor).toBe('#abcdef');
    expect(data.appState.viewBackgroundColor).toBe('#123456');
    expect(data.scrollToContent).toBe(true);
  });

  it('defaults viewBackgroundColor to white and scrollToContent to false for an empty scene', () => {
    const data = buildInitialData({ scene: emptySketchScene(), fileName: 'empty', defaultStrokeColor: '#000' });
    expect(data.appState.viewBackgroundColor).toBe('#ffffff');
    expect(data.scrollToContent).toBe(false);
  });
});

describe('sceneFromExcalidraw', () => {
  it('deep-clones and sanitizes the scene', () => {
    const elements = [{ id: '1', isDeleted: false }];
    const appState = { viewBackgroundColor: '#fff', openDialog: { name: 'x' } };
    const files = { f1: { mimeType: 'image/png' } };
    const scene = sceneFromExcalidraw({ elements, appState, files });
    expect(scene.elements).toEqual(elements);
    expect(scene.elements).not.toBe(elements);
    expect(scene.appState).toEqual({ viewBackgroundColor: '#fff' });
    expect(scene.files).toEqual(files);
  });
});

describe('isNonDeletedExcalidrawElement', () => {
  it('rejects deleted elements and non-objects', () => {
    expect(isNonDeletedExcalidrawElement({ isDeleted: true })).toBe(false);
    expect(isNonDeletedExcalidrawElement(null)).toBe(false);
    expect(isNonDeletedExcalidrawElement('x')).toBe(false);
  });

  it('accepts a non-deleted element', () => {
    expect(isNonDeletedExcalidrawElement({ isDeleted: false })).toBe(true);
    expect(isNonDeletedExcalidrawElement({})).toBe(true);
  });
});

describe('sceneContentSignature', () => {
  it('is stable across identical content', () => {
    const elements = [{ id: '1', version: 1, versionNonce: 1, isDeleted: false }];
    const appState = { viewBackgroundColor: '#fff' };
    const files = {};
    expect(sceneContentSignature({ elements, appState, files })).toBe(sceneContentSignature({ elements, appState, files }));
  });

  it('changes when an element version changes', () => {
    const appState = { viewBackgroundColor: '#fff' };
    const a = sceneContentSignature({ elements: [{ id: '1', version: 1, versionNonce: 1, isDeleted: false }], appState, files: {} });
    const b = sceneContentSignature({ elements: [{ id: '1', version: 2, versionNonce: 1, isDeleted: false }], appState, files: {} });
    expect(a).not.toBe(b);
  });

  it('changes when a versioned element toggles isDeleted', () => {
    const appState = { viewBackgroundColor: '#fff' };
    const a = sceneContentSignature({ elements: [{ id: '1', version: 1, versionNonce: 1, isDeleted: false }], appState, files: {} });
    const b = sceneContentSignature({ elements: [{ id: '1', version: 1, versionNonce: 1, isDeleted: true }], appState, files: {} });
    expect(a).not.toBe(b);
  });

  it('changes when the background color changes', () => {
    const elements = [{ id: '1', version: 1, versionNonce: 1, isDeleted: false }];
    const a = sceneContentSignature({ elements, appState: { viewBackgroundColor: '#fff' }, files: {} });
    const b = sceneContentSignature({ elements, appState: { viewBackgroundColor: '#000' }, files: {} });
    expect(a).not.toBe(b);
  });

  it('is order-independent for file signatures (sorted by id)', () => {
    const elements: unknown[] = [];
    const a = sceneContentSignature({ elements, appState: {}, files: { b: { mimeType: 'image/png' }, a: { mimeType: 'image/jpeg' } } });
    const b = sceneContentSignature({ elements, appState: {}, files: { a: { mimeType: 'image/jpeg' }, b: { mimeType: 'image/png' } } });
    expect(a).toBe(b);
  });

  it('falls back to a stable JSON stringify for an element with no numeric version', () => {
    // Excalidraw elements always carry `version`; a versionless element (a
    // legacy/malformed shape) falls back to sorted-key JSON stringification
    // instead of the fast id:version:versionNonce:isDeleted fingerprint.
    const appState = { viewBackgroundColor: '#fff' };
    const a = sceneContentSignature({ elements: [{ id: '1', type: 'rectangle', extra: { z: 1, a: 2 } }], appState, files: {} });
    const b = sceneContentSignature({ elements: [{ id: '1', extra: { a: 2, z: 1 }, type: 'rectangle' }], appState, files: {} });
    expect(a).toBe(b); // key order in the source object shouldn't matter
    const c = sceneContentSignature({ elements: [{ id: '1', type: 'ellipse', extra: { z: 1, a: 2 } }], appState, files: {} });
    expect(a).not.toBe(c);
  });

  it('sorts arrays nested inside a versionless element (element order preserved, keys sorted)', () => {
    const appState = { viewBackgroundColor: '#fff' };
    const a = sceneContentSignature({ elements: [{ id: '1', points: [{ z: 1, a: 2 }, { z: 3, a: 4 }] }], appState, files: {} });
    const b = sceneContentSignature({ elements: [{ id: '1', points: [{ a: 2, z: 1 }, { a: 4, z: 3 }] }], appState, files: {} });
    expect(a).toBe(b);
    const c = sceneContentSignature({ elements: [{ id: '1', points: [{ z: 3, a: 4 }, { z: 1, a: 2 }] }], appState, files: {} });
    expect(a).not.toBe(c); // array element order still matters
  });

  it('falls back to an empty stable-stringify when a versionless element is not JSON-serializable', () => {
    const circular: Record<string, unknown> = { id: '1' };
    circular.self = circular;
    expect(() => sceneContentSignature({ elements: [circular], appState: {}, files: {} })).not.toThrow();
  });

  it('treats a null/non-object file entry as just its id', () => {
    const elements: unknown[] = [];
    const a = sceneContentSignature({ elements, appState: {}, files: { f1: null } });
    const b = sceneContentSignature({ elements, appState: {}, files: { f1: 'not-an-object' } });
    expect(a).toBe(b);
  });

  it('defaults a file entry missing mimeType/created to empty segments', () => {
    const elements: unknown[] = [];
    const withDefaults = sceneContentSignature({ elements, appState: {}, files: { f1: { dataURL: 'data:,abc' } } });
    const withExplicit = sceneContentSignature({ elements, appState: {}, files: { f1: { mimeType: '', created: '', dataURL: 'data:,abc' } } });
    expect(withDefaults).toBe(withExplicit);
  });
});

describe('exportedImageFileName', () => {
  it('strips the last extension by default, dropping any directory prefix', () => {
    expect(exportedImageFileName({ fileName: 'diagram.excalidraw' })).toBe('diagram.png');
    expect(exportedImageFileName({ fileName: 'nested/path/diagram.sketch.json' })).toBe('diagram.sketch.png');
  });

  it('strips a caller-supplied multi-part extension', () => {
    expect(exportedImageFileName({ fileName: 'diagram.sketch.json' }, { sourceExtension: '.sketch.json' })).toBe('diagram.png');
  });

  it('falls back to "sketch" for an empty stem', () => {
    expect(exportedImageFileName({ fileName: '.excalidraw' })).toBe('sketch.png');
  });

  it('leaves the base name untouched when a caller-supplied extension does not match', () => {
    expect(exportedImageFileName({ fileName: 'diagram.png' }, { sourceExtension: '.sketch.json' })).toBe('diagram.png.png');
  });

  it('treats an explicit empty-string sourceExtension as "strip nothing" (not "unset")', () => {
    // Regression: `sourceExtension ? … : …` (truthy check) would silently
    // treat `''` the same as "not provided" and fall back to stripping the
    // last extension present — `typeof … === 'string'` is what makes an
    // explicit `''` distinguishable and honored.
    expect(exportedImageFileName({ fileName: 'diagram.excalidraw' }, { sourceExtension: '' })).toBe('diagram.excalidraw.png');
  });
});

describe('exportedImageResultFileName', () => {
  it('uses the result file name when provided', () => {
    expect(exportedImageResultFileName({ result: { fileName: 'custom.png' }, fallback: 'fallback.png' })).toBe('custom.png');
  });

  it('falls back for boolean/void results', () => {
    expect(exportedImageResultFileName({ result: true, fallback: 'fallback.png' })).toBe('fallback.png');
    expect(exportedImageResultFileName({ result: undefined, fallback: 'fallback.png' })).toBe('fallback.png');
  });
});

describe('resolveDefaultSketchToolColor / defaultExcalidrawLangCode', () => {
  it('resolves an explicit theme first', () => {
    expect(resolveDefaultSketchToolColor({ theme: 'dark', prefersDark: false })).toBe('#ffffff');
    expect(resolveDefaultSketchToolColor({ theme: 'light', prefersDark: true })).toBe('#1c1b1a');
  });

  it('falls back to prefers-color-scheme when theme is unset', () => {
    expect(resolveDefaultSketchToolColor({ theme: null, prefersDark: true })).toBe('#ffffff');
    expect(resolveDefaultSketchToolColor({ theme: null, prefersDark: false })).toBe('#1c1b1a');
  });

  it('maps a known locale to its Excalidraw langCode', () => {
    expect(defaultExcalidrawLangCode('zh-CN')).toBe('zh-CN');
    expect(defaultExcalidrawLangCode('fr')).toBe('fr-FR');
  });

  it('falls back to "en" for an unknown locale', () => {
    expect(defaultExcalidrawLangCode('xx-unknown')).toBe('en');
  });

  it('accepts a host-supplied override map', () => {
    expect(defaultExcalidrawLangCode('en', { en: 'en-CUSTOM' })).toBe('en-CUSTOM');
  });
});

describe('normalizeTooltipLabel', () => {
  it('collapses whitespace and trims', () => {
    expect(normalizeTooltipLabel({ value: '  Main   menu  ' })).toBe('Main menu');
  });

  it('returns null for empty/whitespace-only/nullish input', () => {
    expect(normalizeTooltipLabel({ value: '   ' })).toBeNull();
    expect(normalizeTooltipLabel({ value: null })).toBeNull();
    expect(normalizeTooltipLabel({ value: undefined })).toBeNull();
  });
});

describe('buildSketchTooltipLabels', () => {
  it('routes every label through t()', () => {
    const labels = buildSketchTooltipLabels({ t: (key) => `[${key}]` });
    expect(labels.mainMenu).toBe('[Main menu]');
    expect(labels.rectangle).toBe('[Rectangle]');
    expect(labels.moreTools).toBe('[More tools]');
  });
});

describe('translateDomTextValue', () => {
  const overrides = { Close: 'Fermer', 'Edit link': 'Modifier le lien' };

  it('translates an exact match, preserving surrounding whitespace', () => {
    expect(translateDomTextValue({ value: '  Close  ', overrides })).toBe('  Fermer  ');
  });

  it('translates a prefix match with " — "/" - "/": " separators', () => {
    expect(translateDomTextValue({ value: 'Edit link — object', overrides })).toBe('Modifier le lien — object');
    expect(translateDomTextValue({ value: 'Edit link - object', overrides })).toBe('Modifier le lien - object');
    expect(translateDomTextValue({ value: 'Edit link: object', overrides })).toBe('Modifier le lien: object');
  });

  it('returns null when nothing matches', () => {
    expect(translateDomTextValue({ value: 'Something else', overrides })).toBeNull();
  });

  it('returns null for whitespace-only input', () => {
    expect(translateDomTextValue({ value: '   ', overrides })).toBeNull();
  });
});

describe('orderContextMenuActions', () => {
  it('filters to the allow-list and reorders to match it', () => {
    expect(orderContextMenuActions({ actionNames: ['copyAsSvg', 'delete', 'copy'], allowList: ['copy', 'paste', 'copyAsPng', 'copyAsSvg'] })).toEqual([
      'copy',
      'copyAsSvg',
    ]);
  });

  it('returns an empty array when nothing is present', () => {
    expect(orderContextMenuActions({ actionNames: ['delete'], allowList: ['copy', 'paste'] })).toEqual([]);
  });
});

describe('validateSketchEmbeddableUrl', () => {
  it('accepts http(s) URLs', () => {
    expect(validateSketchEmbeddableUrl('https://example.com')).toBe(true);
    expect(validateSketchEmbeddableUrl('http://example.com')).toBe(true);
  });

  it('rejects non-http(s) protocols, empty, and malformed input', () => {
    expect(validateSketchEmbeddableUrl('javascript:alert(1)')).toBe(false);
    expect(validateSketchEmbeddableUrl('')).toBe(false);
    expect(validateSketchEmbeddableUrl('   ')).toBe(false);
    expect(validateSketchEmbeddableUrl('not a url')).toBe(false);
  });
});

describe('isExcalidrawUnableToEmbedToast', () => {
  it('recognizes the English "not allowed" phrasing', () => {
    expect(isExcalidrawUnableToEmbedToast({ message: 'Embedding this URL is currently not allowed' })).toBe(true);
  });

  it('recognizes a GitHub-issue-whitelist mention', () => {
    expect(isExcalidrawUnableToEmbedToast({ message: 'Please open a GitHub issue to get this domain whitelisted' })).toBe(true);
  });

  it('recognizes a GitHub+whitelist mention with no "issue" wording (the || right operand alone)', () => {
    expect(isExcalidrawUnableToEmbedToast({ message: 'This domain is not on our GitHub whitelist' })).toBe(true);
  });

  it('rejects a GitHub mention with neither "issue" nor "whitelist"', () => {
    expect(isExcalidrawUnableToEmbedToast({ message: 'View this repository on GitHub' })).toBe(false);
  });

  it('recognizes a host-supplied additional phrase', () => {
    expect(isExcalidrawUnableToEmbedToast({ message: '目前不允许嵌入此网址' }, { additionalPhrases: ['目前不允许嵌入此网址'] })).toBe(true);
  });

  it('rejects an unrelated message', () => {
    expect(isExcalidrawUnableToEmbedToast({ message: 'Saved successfully' })).toBe(false);
  });
});
