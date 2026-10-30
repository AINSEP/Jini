/**
 * Pure logic for the sketch-editor shim: scene (de)serialization, dirty
 * detection via content signatures, export-filename derivation, and the
 * generic parts of the DOM-enhancement toolkit's string handling. No React,
 * no DOM globals — everything here takes plain values and returns plain
 * values.
 */
import type {
  SketchDomTextOverrides,
  SketchExportImageResult,
  SketchExportedImageResult,
  SketchScene,
  SketchTooltipLabelKey,
  SketchTooltipLabels,
  SketchTranslate,
} from './types.js';
import {
  DEFAULT_EXCALIDRAW_LANG_CODES,
  DEFAULT_SKETCH_DARK_TOOL_COLOR,
  DEFAULT_SKETCH_LIGHT_TOOL_COLOR,
} from './constants.js';

export function cloneJson<T>(value: unknown, fallback: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return fallback;
  }
}

/**
 * Strips fields Excalidraw's own `AppState` marks as transient/session-only
 * (open menus/dialogs, in-flight drag/resize/edit state, collaborator
 * cursors) so a persisted scene never rehydrates mid-interaction UI.
 */
export function sanitizeExcalidrawAppState(
  value: Record<string, unknown> | null,
): Record<string, unknown> {
  const appState = value ? cloneJson<Record<string, unknown>>(value, {}) : {};
  delete appState.collaborators;
  delete appState.contextMenu;
  delete appState.draggingElement;
  delete appState.editingElement;
  delete appState.editingTextElement;
  delete appState.frameToHighlight;
  delete appState.newElement;
  delete appState.openDialog;
  delete appState.openMenu;
  delete appState.openPopup;
  delete appState.openSidebar;
  delete appState.defaultSidebarDockedPreference;
  delete appState.pendingImageElementId;
  delete appState.resizingElement;
  delete appState.selectionElement;
  delete appState.suggestedBindings;
  return appState;
}

export function emptySketchScene(name?: string): SketchScene {
  return {
    elements: [],
    appState: {
      name: name ?? null,
      viewBackgroundColor: '#ffffff',
      gridSize: null,
    },
    files: {},
  };
}

export function sketchSceneHasContent(scene: SketchScene | null | undefined): boolean {
  return Boolean(
    scene?.elements.some((element) => {
      if (!element || typeof element !== 'object') return false;
      return (element as { isDeleted?: unknown }).isDeleted !== true;
    }),
  );
}

export function buildInitialData(
  scene: SketchScene,
  fileName: string,
  defaultStrokeColor: string,
): {
  elements: readonly unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
  scrollToContent: boolean;
} {
  return {
    elements: scene.elements,
    appState: {
      ...sanitizeExcalidrawAppState(scene.appState),
      name: fileName,
      currentItemStrokeColor: defaultStrokeColor,
      viewBackgroundColor:
        typeof scene.appState?.viewBackgroundColor === 'string'
          ? scene.appState.viewBackgroundColor
          : '#ffffff',
    },
    files: scene.files,
    scrollToContent: scene.elements.length > 0,
  };
}

export function sceneFromExcalidraw(
  elements: readonly unknown[],
  appState: Record<string, unknown>,
  files: Record<string, unknown>,
): SketchScene {
  return {
    elements: cloneJson<unknown[]>(elements, []),
    appState: sanitizeExcalidrawAppState(cloneJson<Record<string, unknown> | null>(appState, null)),
    files: cloneJson<Record<string, unknown>>(files, {}),
  };
}

export function isNonDeletedExcalidrawElement(element: unknown): boolean {
  return Boolean(
    element && typeof element === 'object' && (element as { isDeleted?: unknown }).isDeleted !== true,
  );
}

function stableJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(sortJsonValue(value));
  } catch {
    return '';
  }
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  return Object.keys(record)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = sortJsonValue(record[key]);
      return acc;
    }, {});
}

/**
 * A content-only fingerprint of a scene, used to dedupe Excalidraw's
 * `onChange` firing against no-op re-renders (it fires on selection/hover
 * changes too, not just content edits).
 */
export function sceneContentSignature(
  elements: readonly unknown[],
  appState: Record<string, unknown>,
  files: Record<string, unknown>,
): string {
  const elementSignature = elements
    .map((element) => {
      const record = element as Record<string, unknown>;
      if (typeof record?.version === 'number') {
        return [record.id, record.version, record.versionNonce, record.isDeleted ? 1 : 0].join(':');
      }
      return stableJsonStringify(element);
    })
    .join('|');
  const fileSignature = Object.keys(files)
    .sort()
    .map((id) => {
      const file = files[id];
      if (!file || typeof file !== 'object') return id;
      const record = file as Record<string, unknown>;
      const dataURL = record.dataURL;
      return [id, record.mimeType ?? '', record.created ?? '', typeof dataURL === 'string' ? dataURL.length : 0].join(
        ':',
      );
    })
    .join('|');
  const viewBackgroundColor = typeof appState.viewBackgroundColor === 'string' ? appState.viewBackgroundColor : '';
  return `${elementSignature}\n${fileSignature}\n${viewBackgroundColor}`;
}

/**
 * Strips a known source extension (default: the last `.ext`) and appends
 * `.png`. `sourceExtension` is checked with `typeof ... === 'string'`, not
 * truthiness: a caller explicitly passing `''` means "strip nothing," which
 * must be distinguishable from "not provided" (which strips the last
 * extension present) — a truthy check would silently treat both the same.
 */
export function exportedImageFileName(fileName: string, sourceExtension?: string): string {
  const slash = fileName.lastIndexOf('/');
  const baseName = slash >= 0 ? fileName.slice(slash + 1) : fileName;
  const stem = typeof sourceExtension === 'string'
    ? stripKnownExtension(baseName, sourceExtension)
    : baseName.replace(/\.[^./]+$/, '');
  return `${stem || 'sketch'}.png`;
}

function stripKnownExtension(baseName: string, extension: string): string {
  return baseName.toLowerCase().endsWith(extension.toLowerCase())
    ? baseName.slice(0, baseName.length - extension.length)
    : baseName;
}

export function exportedImageResultFileName(result: SketchExportImageResult, fallback: string): string {
  if (result && typeof result === 'object' && typeof (result as SketchExportedImageResult).fileName === 'string') {
    return (result as SketchExportedImageResult).fileName;
  }
  return fallback;
}

/** The default stroke color a new tool should start with, given the active theme. */
export function resolveDefaultSketchToolColor(theme: string | null, prefersDark: boolean): string {
  if (theme === 'dark') return DEFAULT_SKETCH_DARK_TOOL_COLOR;
  if (theme === 'light') return DEFAULT_SKETCH_LIGHT_TOOL_COLOR;
  return prefersDark ? DEFAULT_SKETCH_DARK_TOOL_COLOR : DEFAULT_SKETCH_LIGHT_TOOL_COLOR;
}

export function defaultExcalidrawLangCode(
  locale: string,
  overrides: Record<string, string> = DEFAULT_EXCALIDRAW_LANG_CODES,
): string {
  return overrides[locale] ?? 'en';
}

export function normalizeTooltipLabel(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  return normalized ? normalized : null;
}

const TOOLTIP_LABEL_KEYS: Record<SketchTooltipLabelKey, string> = {
  mainMenu: 'Main menu',
  lock: 'Lock',
  hand: 'Hand tool',
  selection: 'Selection',
  rectangle: 'Rectangle',
  diamond: 'Diamond',
  ellipse: 'Ellipse',
  arrow: 'Arrow',
  line: 'Line',
  freedraw: 'Freehand draw',
  text: 'Text',
  image: 'Insert image',
  eraser: 'Eraser',
  frame: 'Frame',
  embeddable: 'Embed',
  laser: 'Laser pointer',
  moreTools: 'More tools',
};

/** Builds the toolbar-tooltip label table by routing each English string through `t()`. */
export function buildSketchTooltipLabels(t: SketchTranslate): SketchTooltipLabels {
  const labels = {} as SketchTooltipLabels;
  for (const key of Object.keys(TOOLTIP_LABEL_KEYS) as SketchTooltipLabelKey[]) {
    labels[key] = t(TOOLTIP_LABEL_KEYS[key]!);
  }
  return labels;
}

/**
 * Rewrites a raw DOM text/attribute value using a flat `{ english: translated }`
 * table, matching either the whole (trimmed) value or an `"English — rest"` /
 * `"English - rest"` / `"English: rest"` prefix. Returns `null` when nothing
 * in `overrides` matches (caller should leave the node untouched).
 */
export function translateDomTextValue(value: string, overrides: SketchDomTextOverrides): string | null {
  // Split into leading whitespace, core, trailing whitespace (an all-whitespace
  // value is all leading). `trimStart`/`trimEnd` strip exactly regex `\s`.
  const coreStart = value.length - value.trimStart().length;
  const leading = value.slice(0, coreStart);
  const rest = value.slice(coreStart);
  const core = rest.trimEnd();
  const trailing = rest.slice(core.length);
  const normalized = core.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  const exact = overrides[normalized];
  if (exact) return `${leading}${exact}${trailing}`;
  for (const [source, replacement] of Object.entries(overrides)) {
    for (const separator of [' — ', ' - ', ': ']) {
      if (normalized.startsWith(`${source}${separator}`)) {
        return `${leading}${replacement}${normalized.slice(source.length)}${trailing}`;
      }
    }
  }
  return null;
}

/** Filters `actionNames` down to `allowList`, reordered to match `allowList`'s order. */
export function orderContextMenuActions(actionNames: readonly string[], allowList: readonly string[]): string[] {
  const present = new Set(actionNames);
  return allowList.filter((action) => present.has(action));
}

export function validateSketchEmbeddableUrl(link: string): boolean {
  const trimmed = link.trim();
  if (!trimmed) return false;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Detects Excalidraw's built-in "embedding this URL isn't allowed" toast by
 * its English phrasing (a GitHub-issue-whitelist message), plus any
 * additional locale-specific phrasings a host has already translated via
 * its own `domTextOverrides` table (so the detection stays in sync with
 * whatever the host chose to translate, rather than hardcoding one
 * product's translations here).
 */
export function isExcalidrawUnableToEmbedToast(message: string, additionalPhrases: readonly string[] = []): boolean {
  const lower = message.toLowerCase();
  if (lower.includes('embedding this url is currently not allowed')) return true;
  if (additionalPhrases.some((phrase) => message.includes(phrase))) return true;
  return lower.includes('github') && (lower.includes('issue') || lower.includes('whitelist'));
}
