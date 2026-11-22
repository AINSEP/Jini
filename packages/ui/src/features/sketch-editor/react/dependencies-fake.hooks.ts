import { useEffect, useRef } from 'react';
import type { FakeExcalidrawProps } from './dependencies-fake.js';

/** Mirror the fake canvas's mount-once API and observable draw operation. */
export function useFakeExcalidraw({ initialData, excalidrawAPI, onChange }: {
  initialData: FakeExcalidrawProps['initialData']; excalidrawAPI: FakeExcalidrawProps['excalidrawAPI']; onChange: FakeExcalidrawProps['onChange'];
}, _options = {}) {
  const initialApi = useRef(excalidrawAPI);
  const elementsRef = useRef<unknown[]>((initialData?.elements ?? []).slice());
  const appStateRef = useRef<Record<string, unknown>>({ ...(initialData?.appState ?? {}) });
  const filesRef = useRef<Record<string, unknown>>({ ...(initialData?.files ?? {}) });
  const elementCounterRef = useRef(0);

  useEffect(() => {
    initialApi.current?.({
      updateScene: (partial: { appState?: Record<string, unknown> } | undefined) => {
        if (partial?.appState) appStateRef.current = { ...appStateRef.current, ...partial.appState };
      },
      getSceneElementsIncludingDeleted: () => elementsRef.current,
      getAppState: () => appStateRef.current,
      getFiles: () => filesRef.current,
    });
    // Mount-once, matching real Excalidraw's own imperative-handle-once contract.
  }, []);

  const fireChange = () => {
    elementCounterRef.current += 1;
    const counter = elementCounterRef.current;
    const nextElements = [
      ...elementsRef.current,
      { id: `fake-element-${counter}`, version: counter, versionNonce: counter, isDeleted: false, type: 'rectangle' },
    ];
    elementsRef.current = nextElements;
    onChange?.(nextElements, appStateRef.current, filesRef.current);
  };

  return { fireChange };
}
