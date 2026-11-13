import { useEffect, useRef } from 'react';
import type { FakeExcalidrawProps } from './dependencies-fake.js';

let fakeElementCounter = 0;

/** Mirror the fake canvas's mount-once API and observable draw operation. */
export function useFakeExcalidraw({ initialData, excalidrawAPI, onChange }: {
  initialData: FakeExcalidrawProps['initialData']; excalidrawAPI: FakeExcalidrawProps['excalidrawAPI']; onChange: FakeExcalidrawProps['onChange'];
}, _options = {}) {
  const initialApi = useRef(excalidrawAPI);
  const elementsRef = useRef<unknown[]>((initialData?.elements ?? []).slice());
  const appStateRef = useRef<Record<string, unknown>>({ ...(initialData?.appState ?? {}) });
  const filesRef = useRef<Record<string, unknown>>({ ...(initialData?.files ?? {}) });

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
    fakeElementCounter += 1;
    const nextElements = [
      ...elementsRef.current,
      { id: `fake-element-${fakeElementCounter}`, version: fakeElementCounter, versionNonce: fakeElementCounter, isDeleted: false, type: 'rectangle' },
    ];
    elementsRef.current = nextElements;
    onChange?.(nextElements, appStateRef.current, filesRef.current);
  };

  return { fireChange };
}
