import type { SketchTooltipTarget } from './types.js';

export const SAVED_VISIBLE_MS = 2000;
export const EXPORTED_IMAGE_MIME_TYPE = 'image/png';
export const SKETCH_CONTEXT_MENU_MARGIN = 8;

/**
 * Default tool/menu tooltip targets — these selectors and `data-testid`
 * values are Excalidraw's own toolbar markup, not host-product content.
 * Host-overridable via `SketchEditorProps.tooltipTargets` for a forked or
 * newer Excalidraw build with different markup.
 */
export const DEFAULT_SKETCH_TOOLTIP_TARGETS: readonly SketchTooltipTarget[] = [
  { selector: '[data-testid="main-menu-trigger"]', label: 'mainMenu', placement: 'bottom' },
  { selector: '[data-testid="toolbar-lock"]', target: 'closest-label', label: 'lock', placement: 'bottom' },
  { selector: '[data-testid="toolbar-hand"]', target: 'closest-label', label: 'hand', placement: 'bottom' },
  { selector: '[data-testid="toolbar-selection"]', target: 'closest-label', label: 'selection', placement: 'bottom' },
  { selector: '[data-testid="toolbar-rectangle"]', target: 'closest-label', label: 'rectangle', placement: 'bottom' },
  { selector: '[data-testid="toolbar-diamond"]', target: 'closest-label', label: 'diamond', placement: 'bottom' },
  { selector: '[data-testid="toolbar-ellipse"]', target: 'closest-label', label: 'ellipse', placement: 'bottom' },
  { selector: '[data-testid="toolbar-arrow"]', target: 'closest-label', label: 'arrow', placement: 'bottom' },
  { selector: '[data-testid="toolbar-line"]', target: 'closest-label', label: 'line', placement: 'bottom' },
  { selector: '[data-testid="toolbar-freedraw"]', target: 'closest-label', label: 'freedraw', placement: 'bottom' },
  { selector: '[data-testid="toolbar-text"]', target: 'closest-label', label: 'text', placement: 'bottom' },
  { selector: '[data-testid="toolbar-image"]', target: 'closest-label', label: 'image', placement: 'bottom' },
  { selector: '[data-testid="toolbar-eraser"]', target: 'closest-label', label: 'eraser', placement: 'bottom' },
  { selector: '[data-testid="toolbar-frame"]', target: 'closest-label', label: 'frame', placement: 'bottom' },
  { selector: '[data-testid="toolbar-embeddable"]', target: 'closest-label', label: 'embeddable', placement: 'bottom' },
  { selector: '[data-testid="toolbar-laser"]', target: 'closest-label', label: 'laser', placement: 'bottom' },
  { selector: '.App-toolbar__extra-tools-trigger', label: 'moreTools', placement: 'bottom' },
];

/**
 * Default context-menu action allow-list + order. These are Excalidraw's
 * own internal action ids (`data-testid` values on its `<li>` entries), not
 * host-product data. A host may override via
 * `SketchEditorProps.contextMenuActionOrder` to show a fuller menu.
 */
export const DEFAULT_CONTEXT_MENU_ACTION_ORDER: readonly string[] = [
  'copy',
  'paste',
  'copyAsPng',
  'copyAsSvg',
];

/**
 * The fuller set of Excalidraw context-menu action ids used only to guard
 * "does this `ul.context-menu` actually belong to the embedded Excalidraw
 * instance" before simplifying it down to `contextMenuActionOrder` — avoids
 * mistaking an unrelated host context menu for Excalidraw's own. Not an
 * allow-list itself.
 */
export const DEFAULT_CONTEXT_MENU_RECOGNIZED_ACTIONS: readonly string[] = [
  ...DEFAULT_CONTEXT_MENU_ACTION_ORDER,
  'addToLibrary',
  'bringForward',
  'bringToFront',
  'copyStyles',
  'cut',
  'delete',
  'duplicate',
  'flipHorizontal',
  'flipVertical',
  'lock',
  'pasteStyles',
  'sendBackward',
  'sendToBack',
  'toggleGrid',
];

/**
 * Default BCP-47-ish language codes Excalidraw expects for its own
 * `langCode` prop. Not host-product data — this is what
 * `@excalidraw/excalidraw` itself ships translations for. Host-overridable
 * via `SketchEditorProps.excalidrawLangCode`.
 */
export const DEFAULT_EXCALIDRAW_LANG_CODES: Record<string, string> = {
  en: 'en',
  id: 'id-ID',
  de: 'de-DE',
  'zh-CN': 'zh-CN',
  'zh-TW': 'zh-TW',
  'pt-BR': 'pt-BR',
  'es-ES': 'es-ES',
  ru: 'ru-RU',
  fa: 'fa-IR',
  ar: 'ar-SA',
  ja: 'ja-JP',
  ko: 'ko-KR',
  pl: 'pl-PL',
  hu: 'hu-HU',
  fr: 'fr-FR',
  uk: 'uk-UA',
  tr: 'tr-TR',
  th: 'th-TH',
  it: 'it-IT',
};

export const SKETCH_TEXT_OVERRIDE_ATTRS = ['title', 'aria-label', 'placeholder'] as const;

export const DEFAULT_SKETCH_LIGHT_TOOL_COLOR = '#1c1b1a';
export const DEFAULT_SKETCH_DARK_TOOL_COLOR = '#ffffff';

/**
 * Matches the Mermaid-dialog "Insert" button's rendered label (English
 * only). The source product's own pattern also matched a hardcoded Chinese
 * translation (`/^(Insert|插入)/i`) — dropped as real translated copy, not a
 * mechanism (see `packages/ui/archived provenance ledger`); a host running Excalidraw in
 * a locale where this button's label differs should pass its own pattern via
 * `SketchEditorProps.mermaidInsertLabelPattern`.
 */
export const DEFAULT_MERMAID_INSERT_LABEL_PATTERN = /^(Insert)(\s|$|→)/i;
