import { createConsoleLogger, type Logger } from '@jini-ai/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { EXPORTED_IMAGE_MIME_TYPE, SAVED_VISIBLE_MS } from '../../constants.js';
import { defaultSketchEditorDependencies } from '../../dependencies.js';
import { exportedImageFileName, exportedImageResultFileName, isNonDeletedExcalidrawElement, sanitizeExcalidrawAppState } from '../../rules.js';
import type { AppState, BinaryFiles, OrderedExcalidrawElement, SketchEditorEnginePort } from '../../ports.js';
import type { SketchExportImageResult, SketchScene, SketchToastState, SketchTranslate } from '../../types.js';

function useLatestRef<T>(value: T): MutableRefObject<T> {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

export interface UseSketchSaveWorkflowParams {
  report?: Pick<Logger, 'warn'> | undefined;
  dirty: boolean;
  saving: boolean;
  savedAt?: number | undefined;
  fileName: string;
  currentScene: () => SketchScene;
  onSave: (scene?: SketchScene) => Promise<boolean | void> | boolean | void;
  onExportImage?:
    | ((
        base64: string,
        fileName: string,
        scene: SketchScene,
      ) => Promise<SketchExportImageResult> | SketchExportImageResult)
    | undefined;
  onOpenExportedImage?: ((fileName: string) => void) | undefined;
  engine: SketchEditorEnginePort;
  t: SketchTranslate;
  /** Suffix stripped from `fileName` before appending `.png`, e.g. `.excalidraw`. Defaults to stripping the last extension present. */
  sourceFileExtension?: string | undefined;
}

export interface SketchSaveWorkflowController {
  showSaved: boolean;
  exporting: boolean;
  toast: SketchToastState | null;
  handleSave: () => Promise<void>;
  handleExportImage: () => Promise<void>;
  dismissToast: () => void;
  handleToastAction: () => void;
}

/** Debounced "Saved" indicator: hides while dirty, shows briefly once a save lands. */
function useSavedIndicator({ dirty, saving, savedAt }: { dirty: boolean; saving: boolean; savedAt: number | null | undefined }, _options = {}) {
  const [showSaved, setShowSaved] = useState(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hideSaved = useCallback(() => {
    clearTimeout(savedTimerRef.current);
    setShowSaved(false);
  }, []);
  const flashSaved = useCallback(() => {
    setShowSaved(true);
    clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => setShowSaved(false), SAVED_VISIBLE_MS);
  }, []);

  useEffect(() => () => clearTimeout(savedTimerRef.current), []);

  useEffect(() => {
    if (dirty) hideSaved();
  }, [dirty, hideSaved]);

  useEffect(() => {
    if (!savedAt || dirty || saving) return;
    flashSaved();
  }, [dirty, savedAt, saving, flashSaved]);
  return { showSaved, hideSaved, flashSaved };
}

/** The elements and app state handed to the image exporter: live elements, opaque background. */
function exportSceneInput({ scene }: { scene: ReturnType<UseSketchSaveWorkflowParams['currentScene']> }, _options = {}) {
  const exportedElements = scene.elements.filter(isNonDeletedExcalidrawElement) as OrderedExcalidrawElement[];
  const exportedAppState = {
    ...sanitizeExcalidrawAppState(scene.appState),
    exportBackground: true,
    viewBackgroundColor: typeof scene.appState?.viewBackgroundColor === 'string' ? scene.appState.viewBackgroundColor : '#ffffff',
  } as Partial<AppState>;
  return { exportedElements, exportedAppState };
}

/** Renders, encodes and hands off the image; resolves with the toast to show (null when the host declined). Never rejects. */
async function performSketchExport({ scene, engine, exportHandler, fileNameRef, tRef, sourceFileExtension, report }: {
  scene: ReturnType<UseSketchSaveWorkflowParams['currentScene']>; engine: UseSketchSaveWorkflowParams['engine'];
  exportHandler: NonNullable<UseSketchSaveWorkflowParams['onExportImage']>;
  fileNameRef: { current: string }; tRef: { current: UseSketchSaveWorkflowParams['t'] };
  sourceFileExtension: UseSketchSaveWorkflowParams['sourceFileExtension']; report: UseSketchSaveWorkflowParams['report'];
}, _options = {}): Promise<SketchToastState | null> {
  const { exportedElements, exportedAppState } = exportSceneInput({ scene });
  try {
    const blob = await engine.exportToBlob({
      elements: exportedElements,
      appState: exportedAppState,
      files: scene.files as unknown as BinaryFiles,
      mimeType: EXPORTED_IMAGE_MIME_TYPE,
      exportPadding: 16,
    });
    const base64 = await blobToBase64(blob);
    const requestedFileName = exportedImageFileName(fileNameRef.current, sourceFileExtension);
    const result = await exportHandler(base64, requestedFileName, scene);
    if (result === false) return null;
    const savedFileName = exportedImageResultFileName(result, requestedFileName);
    return { message: tRef.current('Image exported'), details: savedFileName, tone: 'success', actionFileName: savedFileName };
  } catch (err) {
    const logger = report ?? createConsoleLogger({ prefix: '[SketchEditor]' });
    logger.warn({ message: 'export image failed' }, { error: err });
    return { message: tRef.current('Could not export image'), tone: 'error' };
  }
}

/**
 * Owns save/export orchestration and the transient "Saved" state: the
 * dirty/saving/savedAt props drive a debounced "Saved" indicator, and
 * `handleSave`/`handleExportImage` surface their own success/failure via a
 * single toast slot.
 */
export function useSketchSaveWorkflow(params: UseSketchSaveWorkflowParams): SketchSaveWorkflowController {
  const { dirty, saving, savedAt, fileName, currentScene, onSave, onExportImage, onOpenExportedImage, engine, t, sourceFileExtension, report } =
    params;
  const { showSaved, hideSaved, flashSaved } = useSavedIndicator({ dirty, saving, savedAt });
  const [exporting, setExporting] = useState(false);
  const [toast, setToast] = useState<SketchToastState | null>(null);
  const onSaveRef = useLatestRef(onSave);
  const onExportImageRef = useLatestRef(onExportImage);
  const onOpenExportedImageRef = useLatestRef(onOpenExportedImage);
  const fileNameRef = useLatestRef(fileName);
  const tRef = useLatestRef(t);
  const toastRef = useLatestRef(toast);

  const handleSave = useCallback(async () => {
    const ok = await onSaveRef.current(currentScene());
    if (ok === false) {
      hideSaved();
      return;
    }
    flashSaved();
    setToast({ message: tRef.current('Saved'), tone: 'success' });
  }, [currentScene, onSaveRef, tRef, hideSaved, flashSaved]);

  const handleExportImage = useCallback(async () => {
    const exportHandler = onExportImageRef.current;
    if (!exportHandler || exporting) return;
    const exportedScene = currentScene();
    setExporting(true);
    const nextToast = await performSketchExport({ scene: exportedScene, engine, exportHandler, fileNameRef, tRef, sourceFileExtension, report });
    if (nextToast) setToast(nextToast);
    setExporting(false);
  }, [currentScene, engine, exporting, fileNameRef, onExportImageRef, sourceFileExtension, tRef, report]);

  const dismissToast = useCallback(() => setToast(null), []);

  const handleToastAction = useCallback(() => {
    const fileNameToOpen = toastRef.current?.actionFileName;
    if (!fileNameToOpen) return;
    onOpenExportedImageRef.current?.(fileNameToOpen);
    setToast(null);
  }, [onOpenExportedImageRef, toastRef]);

  return { showSaved, exporting, toast, handleSave, handleExportImage, dismissToast, handleToastAction };
}

/**
 * Wires `useSketchSaveWorkflow` to the real (`@excalidraw/excalidraw`-backed)
 * engine from `dependencies.ts`. Production callers that don't need to swap
 * the engine (i.e. everyone except `SketchEditor`, which accepts its own
 * `dependencies` prop so hosts/tests can inject a fake) should call this
 * instead of threading `engine` themselves.
 */
export function useWiredSketchSaveWorkflow(
  params: Omit<UseSketchSaveWorkflowParams, 'engine'>,
): SketchSaveWorkflowController {
  return useSketchSaveWorkflow({ ...params, engine: defaultSketchEditorDependencies.engine });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Could not read exported image'));
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}
