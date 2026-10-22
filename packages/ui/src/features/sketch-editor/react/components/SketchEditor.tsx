import { useRef } from 'react';
import { useI18n } from '../../../i18n/index.js';
import { Toast } from '../../../../react/components/Toast.js';
import { defaultSketchEditorDependencies } from '../../dependencies.js';
import { defaultExcalidrawLangCode, sketchSceneHasContent, validateSketchEmbeddableUrl } from '../../rules.js';
import type { ExcalidrawInitialDataState, SketchEditorDependencies } from '../../ports.js';
import type {
  SketchDomTextOverrides,
  SketchExportImageResult,
  SketchScene,
  SketchSceneChangeOptions,
  SketchTooltipTarget,
  SketchTranslate,
} from '../../types.js';
import { useSketchDomEnhancements } from '../hooks/useSketchDomEnhancements.js';
import { useSketchSaveWorkflow } from '../hooks/useSketchSaveWorkflow.js';
import { useSketchScene } from '../hooks/useSketchScene.js';
import { useSketchTheme } from '../hooks/useSketchTheme.js';
import { SketchMainMenu } from './SketchMainMenu.js';
import { SketchSaveStateBadge, type SketchSaveStateBadgeProps } from './SketchSaveStateBadge.js';

export interface SketchEditorProps {
  scene: SketchScene;
  onSceneChange: (scene: SketchScene, options?: SketchSceneChangeOptions) => void;
  onClear?: () => void;
  onSave: (scene?: SketchScene) => Promise<boolean | void> | boolean | void;
  onExportImage?: (
    base64: string,
    fileName: string,
    scene: SketchScene,
  ) => Promise<SketchExportImageResult> | SketchExportImageResult;
  onOpenExportedImage?: (fileName: string) => void;
  saving?: boolean;
  dirty?: boolean;
  savedAt?: number;
  fileName: string;
  /** Overrides the default locale → Excalidraw `langCode` mapping. */
  excalidrawLangCode?: (locale: string) => string;
  /** Host translations for Excalidraw's own baked-in English UI text — no
   *  default translated copy ships (see `packages/ui/source-map.md`). */
  domTextOverrides?: SketchDomTextOverrides;
  tooltipTargets?: readonly SketchTooltipTarget[];
  contextMenuActionOrder?: readonly string[];
  contextMenuRecognizedActions?: readonly string[];
  /** Locale-specific phrasings of Excalidraw's "can't embed this URL" toast a
   *  host has already translated via `domTextOverrides`. */
  embedUnavailableAdditionalPhrases?: readonly string[];
  /**
   * Matches the Mermaid-dialog "Insert" button's rendered label, so
   * Command/Ctrl+Enter can submit it. Defaults to English-only
   * (`/^(Insert)(\s|$|→)/i`); a host running Excalidraw in a locale where
   * its own bundled i18n renders this button's label differently (e.g. the
   * source product matched `/^(Insert|插入)/i`) should pass a pattern
   * covering that translation too.
   */
  mermaidInsertLabelPattern?: RegExp;
  /** Suffix stripped from `fileName` before appending `.png` on export.
   *  Defaults to stripping the last extension present. */
  sourceFileExtension?: string;
  /** Swap the bound Excalidraw engine — a host's tests can inject a fake. */
  dependencies?: SketchEditorDependencies;
  /** Custom hook override for dependency injection / testing. */
  useSketchTheme?: typeof useSketchTheme;
}

const EXCALIDRAW_UI_OPTIONS = {
  canvasActions: {
    saveToActiveFile: false,
    loadScene: false,
    toggleTheme: false,
    saveAsImage: false,
    export: false,
  },
  tools: { image: true },
} as const;

/** `saving` wins over `dirty`; only the active label is translated. */
function resolveSaveStatus({ saving, dirty, t }: { saving: boolean; dirty: boolean; t: SketchTranslate }): SketchSaveStateBadgeProps {
  if (saving) return { state: 'saving', label: t('Saving…') };
  if (dirty) return { state: 'dirty', label: t('Unsaved changes') };
  return { state: 'saved', label: t('Saved') };
}

/** An export toast carries a file to open: it lingers longer and offers an
 *  "Open file" action; every other toast is a short-lived notice. */
function sketchToastActionProps({
  actionFileName,
  t,
  onAction,
}: {
  actionFileName: string | undefined;
  t: SketchTranslate;
  onAction: () => void;
}): { ttlMs: number; actionLabel?: string; onAction?: () => void } {
  return actionFileName ? { ttlMs: 5000, actionLabel: t('Open file'), onAction } : { ttlMs: 2200 };
}

/**
 * An Excalidraw-backed sketch surface: theme sync, dirty/save/export
 * orchestration with content-signature deduping, and a DOM-enhancement
 * toolkit (tooltips, simplified context menu, DOM text overrides, portal
 * polish) that makes embedding a third-party editor with no extension
 * hooks feel native. See `packages/ui/source-map.md` for what stayed
 * behind (the source product's legacy pre-Excalidraw item migration, its
 * `.sketch.json` naming convention, and its own translated copy).
 */
export function SketchEditor({
  scene,
  onSceneChange,
  onClear,
  onSave,
  onExportImage,
  onOpenExportedImage,
  saving = false,
  dirty = false,
  savedAt,
  fileName,
  excalidrawLangCode = defaultExcalidrawLangCode,
  domTextOverrides,
  tooltipTargets,
  contextMenuActionOrder,
  contextMenuRecognizedActions,
  embedUnavailableAdditionalPhrases,
  mermaidInsertLabelPattern,
  sourceFileExtension,
  dependencies = defaultSketchEditorDependencies,
  useSketchTheme: useSketchThemeHook = useSketchTheme,
}: SketchEditorProps) {
  const { t, locale } = useI18n();
  const { engine } = dependencies;
  const canvasWrapRef = useRef<HTMLDivElement | null>(null);
  const theme = useSketchThemeHook();

  const {
    initialData,
    editorInstanceKey,
    handleChange,
    currentScene,
    handleClear,
    handleExcalidrawAPI,
    closeActiveDialog,
  } = useSketchScene({ scene, fileName, onSceneChange, onClear });

  // Calls the raw hook (not `useWiredSketchSaveWorkflow`) and threads `engine`
  // explicitly: `SketchEditor` itself accepts a swappable `dependencies` prop
  // (see `SketchEditorProps.dependencies` above) so hosts/tests can inject a
  // fake engine, and the wired hook would bypass that override.
  const { showSaved, exporting, toast, handleSave, handleExportImage, dismissToast, handleToastAction } = useSketchSaveWorkflow({
    dirty,
    saving,
    savedAt,
    fileName,
    currentScene,
    onSave,
    onExportImage,
    onOpenExportedImage,
    engine,
    t,
    sourceFileExtension,
  });

  useSketchDomEnhancements({
    containerRef: canvasWrapRef,
    t,
    domTextOverrides,
    tooltipTargets,
    contextMenuActionOrder,
    contextMenuRecognizedActions,
    embedUnavailableAdditionalPhrases,
    mermaidInsertLabelPattern,
    onCloseActiveDialog: closeActiveDialog,
  });

  const hasContent = sketchSceneHasContent(scene);
  const canSave = dirty || hasContent;
  const saveStatus = resolveSaveStatus({ saving, dirty, t });

  const { Excalidraw, MainMenu } = engine;

  return (
    <div className="sketch-editor">
      <div ref={canvasWrapRef} className="sketch-canvas-wrap sketch-excalidraw-wrap" data-testid="sketch-excalidraw-editor">
        <Excalidraw
          key={editorInstanceKey}
          initialData={initialData as unknown as ExcalidrawInitialDataState}
          excalidrawAPI={handleExcalidrawAPI}
          onChange={handleChange}
          langCode={excalidrawLangCode(locale)}
          theme={theme}
          detectScroll={false}
          handleKeyboardGlobally={false}
          autoFocus
          name={fileName}
          UIOptions={EXCALIDRAW_UI_OPTIONS}
          renderTopRightUI={() => <SketchSaveStateBadge {...saveStatus} />}
          validateEmbeddable={validateSketchEmbeddableUrl}
        >
          <SketchMainMenu
            MainMenu={MainMenu}
            t={t}
            saving={saving}
            showSaved={showSaved}
            canSave={canSave}
            onSave={() => void handleSave()}
            exportAvailable={Boolean(onExportImage)}
            exporting={exporting}
            canExport={hasContent}
            onExportImage={() => void handleExportImage()}
            canClear={hasContent}
            onClear={handleClear}
          />
        </Excalidraw>
      </div>
      {toast ? (
        <Toast
          message={toast.message}
          details={toast.details ?? null}
          tone={toast.tone}
          onDismiss={dismissToast}
          {...sketchToastActionProps({ actionFileName: toast.actionFileName, t, onAction: handleToastAction })}
        />
      ) : null}
    </div>
  );
}
