import type { Logger } from '@jini-ai/core/primitives';
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
  report?: Pick<Logger, 'warn'> | undefined;
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
   *  default translated copy ships (see `070311a07^:packages/ui/source-map.md` (section "features/sketch-editor/")). */
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
  useI18nHook?: typeof useI18n;
  useSketchSceneHook?: typeof useSketchScene;
  useSketchSaveWorkflowHook?: typeof useSketchSaveWorkflow;
  useSketchDomEnhancementsHook?: typeof useSketchDomEnhancements;
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

type SketchSceneState = ReturnType<typeof useSketchScene>;
type SketchSaveWorkflow = ReturnType<typeof useSketchSaveWorkflow>;

function SketchSaveToast({ workflow, t }: { workflow: SketchSaveWorkflow; t: ReturnType<typeof useI18n>['t'] }) {
  const { toast } = workflow;
  if (!toast) return null;
  return (
    <Toast
      message={toast.message}
      details={toast.details ?? null}
      tone={toast.tone}
      onDismiss={workflow.dismissToast}
      {...sketchToastActionProps({ actionFileName: toast.actionFileName, t, onAction: workflow.handleToastAction })}
    />
  );
}

interface SketchCanvasProps {
  props: SketchEditorProps;
  engine: SketchEditorDependencies['engine'];
  theme: ReturnType<typeof useSketchTheme>;
  sceneState: SketchSceneState;
  workflow: SketchSaveWorkflow;
  hasContent: boolean;
  useI18nHook?: typeof useI18n;
}

function SketchCanvas({ props, engine, theme, sceneState, workflow, hasContent, useI18nHook = useI18n }: SketchCanvasProps) {
  const { t, locale } = useI18nHook();
  const { saving = false, dirty = false } = props;
  const { Excalidraw, MainMenu } = engine;
  return (
    <Excalidraw
      key={sceneState.editorInstanceKey}
      initialData={sceneState.initialData as unknown as ExcalidrawInitialDataState}
      excalidrawAPI={sceneState.handleExcalidrawAPI}
      onChange={sceneState.handleChange}
      langCode={(props.excalidrawLangCode ?? defaultExcalidrawLangCode)(locale)}
      theme={theme}
      detectScroll={false}
      handleKeyboardGlobally={false}
      autoFocus
      name={props.fileName}
      UIOptions={EXCALIDRAW_UI_OPTIONS}
      renderTopRightUI={() => <SketchSaveStateBadge {...resolveSaveStatus({ saving, dirty, t })} />}
      validateEmbeddable={validateSketchEmbeddableUrl}
    >
      <SketchMainMenu
        MainMenu={MainMenu}
        t={t}
        saving={saving}
        showSaved={workflow.showSaved}
        canSave={dirty || hasContent}
        onSave={() => void workflow.handleSave()}
        exportAvailable={Boolean(props.onExportImage)}
        exporting={workflow.exporting}
        canExport={hasContent}
        onExportImage={() => void workflow.handleExportImage()}
        canClear={hasContent}
        onClear={sceneState.handleClear}
      />
    </Excalidraw>
  );
}

/**
 * An Excalidraw-backed sketch surface: theme sync, dirty/save/export
 * orchestration with content-signature deduping, and a DOM-enhancement
 * toolkit (tooltips, simplified context menu, DOM text overrides, portal
 * polish) that makes embedding a third-party editor with no extension
 * hooks feel native. See `070311a07^:packages/ui/source-map.md` (section "features/sketch-editor/") for what stayed
 * behind (the source product's legacy pre-Excalidraw item migration, its
 * `.sketch.json` naming convention, and its own translated copy).
 */
export function SketchEditor({ useI18nHook = useI18n, useSketchSceneHook = useSketchScene, useSketchSaveWorkflowHook = useSketchSaveWorkflow, useSketchDomEnhancementsHook = useSketchDomEnhancements, ...props }: SketchEditorProps) {
  const { scene, fileName, onSceneChange, onClear, saving = false, dirty = false } = props;
  const { t } = useI18nHook();
  const { engine } = props.dependencies ?? defaultSketchEditorDependencies;
  const canvasWrapRef = useRef<HTMLDivElement | null>(null);
  const theme = (props.useSketchTheme ?? useSketchTheme)();
  const sceneState = useSketchSceneHook({ scene, fileName, onSceneChange, onClear });

  // Calls the raw hook (not `useWiredSketchSaveWorkflow`) and threads `engine`
  // explicitly: `SketchEditor` itself accepts a swappable `dependencies` prop
  // (see `SketchEditorProps.dependencies` above) so hosts/tests can inject a
  // fake engine, and the wired hook would bypass that override.
  const workflow = useSketchSaveWorkflowHook({
    dirty,
    saving,
    savedAt: props.savedAt,
    fileName,
    currentScene: sceneState.currentScene,
    onSave: props.onSave,
    onExportImage: props.onExportImage,
    onOpenExportedImage: props.onOpenExportedImage,
    engine,
    t,
    sourceFileExtension: props.sourceFileExtension, report: props.report,
  });

  useSketchDomEnhancementsHook({
    containerRef: canvasWrapRef,
    t,
    domTextOverrides: props.domTextOverrides,
    tooltipTargets: props.tooltipTargets,
    contextMenuActionOrder: props.contextMenuActionOrder,
    contextMenuRecognizedActions: props.contextMenuRecognizedActions,
    embedUnavailableAdditionalPhrases: props.embedUnavailableAdditionalPhrases,
    mermaidInsertLabelPattern: props.mermaidInsertLabelPattern,
    onCloseActiveDialog: sceneState.closeActiveDialog,
  });

  return (
    <div className="sketch-editor">
      <div ref={canvasWrapRef} className="sketch-canvas-wrap sketch-excalidraw-wrap" data-testid="sketch-excalidraw-editor">
        <SketchCanvas
          props={props}
          engine={engine}
          theme={theme}
          sceneState={sceneState}
          workflow={workflow}
          hasContent={sketchSceneHasContent({ scene })}
        />
      </div>
      <SketchSaveToast workflow={workflow} t={t} />
    </div>
  );
}
