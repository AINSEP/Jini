import { useCallback, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI, OrderedExcalidrawElement } from '../../ports.js';
import { readDefaultSketchToolColor } from '../../dom.js';
import { buildInitialData, emptySketchScene, sceneContentSignature, sceneFromExcalidraw } from '../../rules.js';
import type { SketchScene, SketchSceneChangeOptions } from '../../types.js';

function asRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function useLatestRef<T>(value: T): MutableRefObject<T> {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

export interface UseSketchSceneParams {
  scene: SketchScene;
  fileName: string;
  onSceneChange: (scene: SketchScene, options?: SketchSceneChangeOptions) => void;
  onClear?: (() => void) | undefined;
}

export interface SketchSceneController {
  apiRef: MutableRefObject<ExcalidrawImperativeAPI | null>;
  editorInstanceKey: string;
  initialData: ReturnType<typeof buildInitialData>;
  handleChange: (elements: readonly OrderedExcalidrawElement[], appState: AppState, files: BinaryFiles) => void;
  currentScene: () => SketchScene;
  handleClear: () => void;
  handleExcalidrawAPI: (api: ExcalidrawImperativeAPI) => void;
  closeActiveDialog: () => void;
}

/**
 * Owns the Excalidraw imperative API handle, the reset-on-clear instance
 * key, initial-data memoization (only recomputed when `fileName`/reset
 * changes — Excalidraw treats a changed `key` as a full remount), and the
 * content-signature-deduped change/save/clear plumbing.
 */
export function useSketchScene({ scene, fileName, onSceneChange, onClear }: UseSketchSceneParams): SketchSceneController {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const [resetNonce, setResetNonce] = useState(0);
  const onSceneChangeRef = useLatestRef(onSceneChange);
  const onClearRef = useLatestRef(onClear);
  const sceneRef = useLatestRef(scene);
  const fileNameRef = useLatestRef(fileName);
  const skipHydrationChangeRef = useRef(true);
  const lastContentSignatureRef = useRef<string | null>(null);
  const editorInstanceKey = `${fileName}:${resetNonce}`;
  const previousEditorInstanceKeyRef = useRef<string | null>(null);
  const initialDataRef = useRef<{ key: string; value: ReturnType<typeof buildInitialData> } | null>(null);

  if (previousEditorInstanceKeyRef.current !== editorInstanceKey) {
    previousEditorInstanceKeyRef.current = editorInstanceKey;
    skipHydrationChangeRef.current = true;
    lastContentSignatureRef.current = null;
  }

  let initialDataEntry = initialDataRef.current;
  if (!initialDataEntry || initialDataEntry.key !== editorInstanceKey) {
    initialDataEntry = {
      key: editorInstanceKey,
      value: buildInitialData({ scene, fileName, defaultStrokeColor: readDefaultSketchToolColor() }),
    };
    initialDataRef.current = initialDataEntry;
  }

  const handleChange = useCallback(
    (elements: readonly OrderedExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
      const contentSignature = sceneContentSignature({ elements, appState: asRecord(appState), files: asRecord(files) });
      if (skipHydrationChangeRef.current) {
        skipHydrationChangeRef.current = false;
        lastContentSignatureRef.current = contentSignature;
        return;
      }
      if (lastContentSignatureRef.current === contentSignature) return;
      lastContentSignatureRef.current = contentSignature;

      onSceneChangeRef.current(sceneFromExcalidraw({ elements, appState: asRecord(appState), files: asRecord(files) }), { markDirty: true });
    },
    [onSceneChangeRef],
  );

  const currentScene = useCallback((): SketchScene => {
    const api = apiRef.current;
    if (!api) return sceneRef.current;
    return sceneFromExcalidraw(
      { elements: api.getSceneElementsIncludingDeleted(),
      appState: asRecord(api.getAppState()),
      files: asRecord(api.getFiles()) },
    );
  }, [sceneRef]);

  const handleClear = useCallback(() => {
    if (onClearRef.current) {
      onClearRef.current();
    } else {
      onSceneChangeRef.current(emptySketchScene({}, { name: fileNameRef.current }), { markDirty: true });
    }
    setResetNonce((value) => value + 1);
  }, [fileNameRef, onClearRef, onSceneChangeRef]);

  const handleExcalidrawAPI = useCallback((api: ExcalidrawImperativeAPI) => {
    apiRef.current = api;
  }, []);

  const closeActiveDialog = useCallback(() => {
    apiRef.current?.updateScene({ appState: { openDialog: null } });
  }, []);

  return {
    apiRef,
    editorInstanceKey,
    initialData: initialDataEntry.value,
    handleChange,
    currentScene,
    handleClear,
    handleExcalidrawAPI,
    closeActiveDialog,
  };
}
