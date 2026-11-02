import { formatErrorForLog } from '@jini-ai/core';
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

/**
 * Owns save/export orchestration and the transient "Saved" state: the
 * dirty/saving/savedAt props drive a debounced "Saved" indicator, and
 * `handleSave`/`handleExportImage` surface their own success/failure via a
 * single toast slot.
 */
export function useSketchSaveWorkflow(params: UseSketchSaveWorkflowParams): SketchSaveWorkflowController {
  const { dirty, saving, savedAt, fileName, currentScene, onSave, onExportImage, onOpenExportedImage, engine, t, sourceFileExtension } =
    params;
  const [showSaved, setShowSaved] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [toast, setToast] = useState<SketchToastState | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onSaveRef = useLatestRef(onSave);
  const onExportImageRef = useLatestRef(onExportImage);
  const onOpenExportedImageRef = useLatestRef(onOpenExportedImage);
  const fileNameRef = useLatestRef(fileName);
  const tRef = useLatestRef(t);
  const toastRef = useLatestRef(toast);

  useEffect(() => () => clearTimeout(savedTimerRef.current), []);

  useEffect(() => {
    if (dirty) {
      clearTimeout(savedTimerRef.current);
      setShowSaved(false);
    }
  }, [dirty]);

  useEffect(() => {
    if (!savedAt || dirty || saving) return;
    setShowSaved(true);
    clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => setShowSaved(false), SAVED_VISIBLE_MS);
  }, [dirty, savedAt, saving]);

  const handleSave = useCallback(async () => {
    const ok = await onSaveRef.current(currentScene());
    if (ok === false) {
      clearTimeout(savedTimerRef.current);
      setShowSaved(false);
      return;
    }
    setShowSaved(true);
    setToast({ message: tRef.current('Saved'), tone: 'success' });
    clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => setShowSaved(false), SAVED_VISIBLE_MS);
  }, [currentScene, onSaveRef, tRef]);

  const handleExportImage = useCallback(async () => {
    const exportHandler = onExportImageRef.current;
    if (!exportHandler || exporting) return;
    const exportedScene = currentScene();
    const exportedElements = exportedScene.elements.filter(isNonDeletedExcalidrawElement) as OrderedExcalidrawElement[];
    const exportedAppState = {
      ...sanitizeExcalidrawAppState(exportedScene.appState),
      exportBackground: true,
      viewBackgroundColor:
        typeof exportedScene.appState?.viewBackgroundColor === 'string' ? exportedScene.appState.viewBackgroundColor : '#ffffff',
    } as Partial<AppState>;
    setExporting(true);
    try {
      const blob = await engine.exportToBlob({
        elements: exportedElements,
        appState: exportedAppState,
        files: exportedScene.files as unknown as BinaryFiles,
        mimeType: EXPORTED_IMAGE_MIME_TYPE,
        exportPadding: 16,
      });
      const base64 = await blobToBase64(blob);
      const requestedFileName = exportedImageFileName(fileNameRef.current, sourceFileExtension);
      const result = await exportHandler(base64, requestedFileName, exportedScene);
      if (result === false) return;
      const savedFileName = exportedImageResultFileName(result, requestedFileName);
      setToast({
        message: tRef.current('Image exported'),
        details: savedFileName,
        tone: 'success',
        actionFileName: savedFileName,
      });
    } catch (err) {
      console.warn('[SketchEditor] export image failed', formatErrorForLog({ error: err }));
      setToast({ message: tRef.current('Could not export image'), tone: 'error' });
    } finally {
      setExporting(false);
    }
  }, [currentScene, engine, exporting, fileNameRef, onExportImageRef, sourceFileExtension, tRef]);

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
