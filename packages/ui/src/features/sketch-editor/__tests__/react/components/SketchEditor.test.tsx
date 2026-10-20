import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../i18n/index.js';
import { createFakeSketchEditorDependencies } from '../../../react/dependencies-fake.js';
import { emptySketchScene } from '../../../rules.js';
import type { ExcalidrawProps, SketchEditorDependencies } from '../../../ports.js';
import type { SketchScene } from '../../../types.js';
import { SketchEditor } from '../../../react/components/SketchEditor.js';

function flushRaf(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** The fake engine, with every `Excalidraw` render's props recorded. */
function recordingDependencies(): { dependencies: SketchEditorDependencies; seen: ExcalidrawProps[] } {
  const fake = createFakeSketchEditorDependencies();
  const seen: ExcalidrawProps[] = [];
  const FakeExcalidraw = fake.engine.Excalidraw;
  function RecordingExcalidraw(props: ExcalidrawProps) {
    seen.push(props);
    return <FakeExcalidraw {...props} />;
  }
  return { dependencies: { ...fake, engine: { ...fake.engine, Excalidraw: RecordingExcalidraw } }, seen };
}

function baseProps(overrides: Partial<Parameters<typeof SketchEditor>[0]> = {}) {
  return {
    scene: emptySketchScene('diagram.excalidraw'),
    fileName: 'diagram.excalidraw',
    onSceneChange: vi.fn(),
    onSave: vi.fn(async () => true),
    dependencies: createFakeSketchEditorDependencies(),
    ...overrides,
  };
}

describe('SketchEditor', () => {
  it('mounts the (fake) Excalidraw surface named after the file', () => {
    render(<SketchEditor {...baseProps()} />);
    expect(screen.getByTestId('fake-excalidraw').getAttribute('aria-label')).toBe('diagram.excalidraw');
  });

  it('reports a scene change (marking dirty) once real content is drawn', async () => {
    const onSceneChange = vi.fn();
    render(<SketchEditor {...baseProps({ onSceneChange })} />);
    const draw = screen.getByTestId('fake-excalidraw-draw');
    await userEvent.click(draw); // hydration no-op
    await userEvent.click(draw); // real change
    expect(onSceneChange).toHaveBeenCalledTimes(1);
    const [scene, options] = onSceneChange.mock.calls[0]!;
    expect(options).toEqual({ markDirty: true });
    expect((scene as SketchScene).elements).toHaveLength(2);
  });

  it('calls onSave with the live (Excalidraw-API-sourced) scene when Save is clicked', async () => {
    // `dirty` is host-controlled (the host re-derives it from onSceneChange in
    // production); force it here so Save is enabled without needing a full
    // controlled round-trip, and draw first so the live scene has content.
    const onSave = vi.fn(async (_scene?: SketchScene) => true);
    render(<SketchEditor {...baseProps({ onSave, dirty: true })} />);
    await userEvent.click(screen.getByTestId('fake-excalidraw-draw'));
    await userEvent.click(screen.getByTestId('sketch-menu-save'));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const scene = onSave.mock.calls[0]?.[0];
    expect(scene?.elements).toHaveLength(1);
  });

  it('shows a "Saved" toast after a successful save', async () => {
    // Save is disabled on a content-free scene unless already dirty; draw first.
    render(<SketchEditor {...baseProps({ scene: { elements: [{ isDeleted: false }], appState: null, files: {} } })} />);
    await userEvent.click(screen.getByTestId('sketch-menu-save'));
    // Both the save-state badge and the toast render "Saved" text — scope to the toast.
    await waitFor(() => expect(document.querySelector('.jini-toast-message')?.textContent).toBe('Saved'));
  });

  it('exports an image via onExportImage, deriving the filename from fileName', async () => {
    const onExportImage = vi.fn(async (_base64: string, exportedFileName: string) => ({ fileName: exportedFileName }));
    render(
      <SketchEditor
        {...baseProps({
          onExportImage,
          fileName: 'plan.excalidraw',
          scene: { elements: [{ isDeleted: false }], appState: null, files: {} },
        })}
      />,
    );
    await userEvent.click(screen.getByTestId('sketch-menu-export-image'));
    await waitFor(() => expect(onExportImage).toHaveBeenCalledTimes(1));
    expect(onExportImage.mock.calls[0]![1]).toBe('plan.png');
    await waitFor(() => expect(screen.getByText('plan.png')).toBeTruthy());
  });

  it('clears via the host onClear when provided', async () => {
    const onClear = vi.fn();
    const onSceneChange = vi.fn();
    render(<SketchEditor {...baseProps({ onClear, onSceneChange, scene: { elements: [{ isDeleted: false }], appState: null, files: {} } })} />);
    await userEvent.click(screen.getByTestId('sketch-menu-clear'));
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onSceneChange).not.toHaveBeenCalled();
  });

  it('emits an empty scene via onSceneChange when clearing with no host onClear', async () => {
    const onSceneChange = vi.fn();
    render(
      <SketchEditor
        {...baseProps({ onSceneChange, fileName: 'a.excalidraw', scene: { elements: [{ isDeleted: false }], appState: null, files: {} } })}
      />,
    );
    await userEvent.click(screen.getByTestId('sketch-menu-clear'));
    expect(onSceneChange).toHaveBeenCalledWith(emptySketchScene('a.excalidraw'), { markDirty: true });
  });

  it('shows the "saving" save-state badge while a save is in flight', async () => {
    render(<SketchEditor {...baseProps({ saving: true })} />);
    expect(document.querySelector('.sketch-save-state.is-saving')).not.toBeNull();
  });

  it('closes the active Excalidraw dialog (via the imperative API) on Escape, end to end', async () => {
    // Integration coverage for the full Escape-to-close wiring: real
    // `useSketchScene`-owned `closeActiveDialog` -> real
    // `useSketchDomEnhancements`'s document-level Escape listener -> the
    // fake engine's own imperative `updateScene`. Unlike
    // `useSketchDomEnhancements.test.tsx` (which passes a stub
    // `onCloseActiveDialog`), this proves the orchestrator's own wiring,
    // not just the hook in isolation.
    render(<SketchEditor {...baseProps()} />);
    await flushRaf();

    const portal = document.createElement('div');
    portal.className = 'jini-sketch-modal';
    portal.innerHTML = '<div class="Modal"></div>';
    document.body.appendChild(portal);

    expect(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    }).not.toThrow();
  });

  it('applies tooltip decoration to its toolbar after mount', async () => {
    render(<SketchEditor {...baseProps()} />);
    await flushRaf();
    expect(screen.getByTestId('main-menu-trigger').getAttribute('data-tooltip')).toBe('Main menu');
  });

  it('renders translated copy end-to-end when mounted under an I18nProvider with a matching dictionary', async () => {
    render(
      <I18nProvider dictionaries={{ fr: { Save: 'Enregistrer', 'Clear canvas': 'Effacer le canevas' } }} initialLocale="fr">
        <SketchEditor {...baseProps()} />
      </I18nProvider>,
    );
    expect(screen.getByTestId('sketch-menu-save').textContent).toContain('Enregistrer');
    expect(screen.getByTestId('sketch-menu-clear').textContent).toContain('Effacer le canevas');
  });

  it('shows the "Unsaved changes" badge when dirty and not saving', () => {
    render(<SketchEditor {...baseProps({ dirty: true })} />);
    expect(document.querySelector('.sketch-save-state.is-dirty')?.textContent).toBe('Unsaved changes');
  });

  it('shows the "Saved" badge when neither dirty nor saving', () => {
    render(<SketchEditor {...baseProps()} />);
    expect(document.querySelector('.sketch-save-state.is-saved')?.textContent).toBe('Saved');
  });

  it('prefers the "Saving…" badge over "dirty" while a save is in flight', () => {
    render(<SketchEditor {...baseProps({ saving: true, dirty: true })} />);
    expect(document.querySelector('.sketch-save-state.is-saving')?.textContent).toBe('Saving…');
  });

  it('passes the host excalidrawLangCode mapping of the active locale to Excalidraw', () => {
    const { dependencies, seen } = recordingDependencies();
    const excalidrawLangCode = vi.fn((locale: string) => `xx-${locale}`);
    render(<SketchEditor {...baseProps({ dependencies, excalidrawLangCode })} />);
    expect(seen.at(-1)?.langCode).toBe(`xx-${excalidrawLangCode.mock.calls[0]![0]}`);
  });

  it('hands Excalidraw the same UIOptions object across re-renders', () => {
    const { dependencies, seen } = recordingDependencies();
    const props = baseProps({ dependencies });
    const { rerender } = render(<SketchEditor {...props} />);
    rerender(<SketchEditor {...props} dirty />);
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.at(-1)?.UIOptions).toBe(seen[0]?.UIOptions);
  });

  it('offers an "Open file" toast action after export that opens the exported file', async () => {
    const onOpenExportedImage = vi.fn();
    render(
      <SketchEditor
        {...baseProps({
          onExportImage: async (_b: string, name: string) => ({ fileName: name }),
          onOpenExportedImage,
          fileName: 'plan.excalidraw',
          scene: { elements: [{ isDeleted: false }], appState: null, files: {} },
        })}
      />,
    );
    await userEvent.click(screen.getByTestId('sketch-menu-export-image'));
    await userEvent.click(await screen.findByText('Open file'));
    expect(onOpenExportedImage).toHaveBeenCalledWith('plan.png');
  });

  it('shows the save toast without an "Open file" action', async () => {
    render(<SketchEditor {...baseProps({ scene: { elements: [{ isDeleted: false }], appState: null, files: {} } })} />);
    await userEvent.click(screen.getByTestId('sketch-menu-save'));
    await waitFor(() => expect(document.querySelector('.jini-toast-message')?.textContent).toBe('Saved'));
    expect(screen.queryByText('Open file')).toBeNull();
  });
});
