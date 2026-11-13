/**
 * A lightweight, non-canvas React stand-in for `@excalidraw/excalidraw`,
 * used by this feature's own tests (and available to a host's tests too).
 * Real Excalidraw is a canvas-heavy third-party library — mounting it in
 * jsdom to test *our* dirty/save/export/DOM-shim logic would be slow and
 * largely untestable anyway (jsdom has no real canvas). This fake renders
 * just enough DOM (matching toolbar `data-testid`s, a menu-trigger, a
 * top-right-UI slot, and the `children` MainMenu) to exercise every hook
 * and the DOM-enhancement toolkit end-to-end.
 *
 * Lives under `react/` rather than at the feature's top-level
 * `dependencies.ts` (a deliberate exception to the "dependencies.ts has zero
 * React import" convention): the thing being faked is *itself* a React
 * component, so its fake unavoidably needs JSX too.
 */
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { SketchEditorDependencies, SketchEditorEnginePort, SketchMainMenuComponent } from '../ports.js';

let fakeElementCounter = 0;

interface FakeExcalidrawInitialData {
  elements?: unknown[];
  appState?: Record<string, unknown>;
  files?: Record<string, unknown>;
}

interface FakeExcalidrawProps {
  initialData?: FakeExcalidrawInitialData;
  excalidrawAPI?: (api: unknown) => void;
  onChange?: (elements: unknown[], appState: Record<string, unknown>, files: Record<string, unknown>) => void;
  renderTopRightUI?: () => ReactNode;
  name?: string;
  /** Real Excalidraw re-themes its own canvas off this prop with nothing
   *  else in the DOM to observe — surfaced here as `data-theme` so a test
   *  driving `theme` through (e.g. via a `useSketchTheme` override) has
   *  something to actually assert on. */
  theme?: string;
  children?: ReactNode;
}

function FakeExcalidraw({ initialData, excalidrawAPI, onChange, renderTopRightUI, name, theme, children }: FakeExcalidrawProps) {
  const elementsRef = useRef<unknown[]>((initialData?.elements ?? []).slice());
  const appStateRef = useRef<Record<string, unknown>>({ ...(initialData?.appState ?? {}) });
  const filesRef = useRef<Record<string, unknown>>({ ...(initialData?.files ?? {}) });
  const initialExcalidrawAPI = useRef(excalidrawAPI);

  useEffect(() => {
    initialExcalidrawAPI.current?.({
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

  return (
    <div data-testid="fake-excalidraw" aria-label={name} data-theme={theme}>
      <button type="button" data-testid="main-menu-trigger">
        Menu
      </button>
      <button type="button" data-testid="toolbar-selection">
        Selection
      </button>
      <button type="button" data-testid="toolbar-rectangle">
        Rectangle
      </button>
      <button type="button" data-testid="fake-excalidraw-draw" onClick={fireChange}>
        Draw
      </button>
      {renderTopRightUI ? renderTopRightUI() : null}
      {children}
    </div>
  );
}

interface FakeMainMenuItemProps {
  onClick: () => void;
  disabled?: boolean;
  icon?: ReactNode;
  children?: ReactNode;
  [key: string]: unknown;
}

function FakeMainMenuItem({ onClick, disabled, icon, children, ...rest }: FakeMainMenuItemProps) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} {...rest}>
      {icon}
      {children}
    </button>
  );
}

function FakeMainMenuSeparator() {
  return <hr />;
}

function FakeMainMenuBase({ children }: { children?: ReactNode }) {
  return (
    <div data-testid="fake-main-menu" role="menu">
      {children}
    </div>
  );
}

const FakeMainMenu = Object.assign(FakeMainMenuBase, {
  Item: FakeMainMenuItem,
  Separator: FakeMainMenuSeparator,
  DefaultItems: {
    SearchMenu: () => <div data-testid="fake-search-menu" />,
    Help: () => <div data-testid="fake-help-menu" />,
    ChangeCanvasBackground: () => <div data-testid="fake-change-bg" />,
  },
}) as unknown as SketchMainMenuComponent;

export function createFakeSketchEditorEngine(overrides: Partial<SketchEditorEnginePort> = {}): SketchEditorEnginePort {
  return {
    Excalidraw: FakeExcalidraw as unknown as SketchEditorEnginePort['Excalidraw'],
    MainMenu: FakeMainMenu,
    exportToBlob: async () => new Blob(['fake-exported-image'], { type: 'image/png' }),
    ...overrides,
  };
}

export function createFakeSketchEditorDependencies(overrides: Partial<SketchEditorEnginePort> = {}): SketchEditorDependencies {
  return { engine: createFakeSketchEditorEngine(overrides) };
}
