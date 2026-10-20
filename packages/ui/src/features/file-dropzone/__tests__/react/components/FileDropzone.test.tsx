import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FileDropzone } from './FileDropzone.js';
import { I18nProvider } from '../../../i18n/index.js';

function file(name: string, type = '', size = 10): File {
  return new File([new Uint8Array(size)], name, { type });
}

function dataTransfer(files: File[]): DataTransfer {
  return { items: [], files } as unknown as DataTransfer;
}

describe('FileDropzone', () => {
  it('renders a default prompt with no paste mention when enablePaste is not set', () => {
    render(<FileDropzone onFiles={vi.fn()} />);
    expect(screen.getByText('Drag & drop or browse')).toBeInTheDocument();
  });

  it('renders a paste-aware default prompt when enablePaste is set', () => {
    render(<FileDropzone onFiles={vi.fn()} enablePaste />);
    expect(screen.getByText('Drag & drop, paste, or browse')).toBeInTheDocument();
  });

  it('renders a custom prompt when supplied', () => {
    render(<FileDropzone onFiles={vi.fn()} prompt="Drop your brand assets" />);
    expect(screen.getByText('Drop your brand assets')).toBeInTheDocument();
  });

  it('renders the optional label heading', () => {
    render(<FileDropzone onFiles={vi.fn()} label="Local code" />);
    expect(screen.getByText('Local code')).toBeInTheDocument();
  });

  it('omits the label heading when not supplied', () => {
    const { container } = render(<FileDropzone onFiles={vi.fn()} />);
    expect(container.querySelector('.jini-file-dropzone__label')).toBeNull();
  });

  it('shows helper text inside the zone for the bare/rich variant (no names)', () => {
    render(<FileDropzone onFiles={vi.fn()} helper="Up to 12 MB each" />);
    const hint = screen.getByText('Up to 12 MB each');
    expect(hint).toHaveClass('jini-file-dropzone__hint');
  });

  it('shows helper text below the zone (not inside it) for the simple/names variant', () => {
    render(<FileDropzone onFiles={vi.fn()} names={[]} onRemoveName={vi.fn()} helper="Folders are expanded automatically" />);
    const helperEl = screen.getByText('Folders are expanded automatically');
    expect(helperEl.tagName).toBe('P');
    expect(helperEl).toHaveClass('jini-file-dropzone__helper');
  });

  it('a click on the zone opens the file picker exactly once (no double-open via the nested input bubbling back)', async () => {
    render(<FileDropzone onFiles={vi.fn()} />);
    const input = document.querySelector('.jini-file-dropzone__input') as HTMLInputElement;
    const clickSpy = vi.spyOn(input, 'click');
    await userEvent.click(screen.getByTestId('file-dropzone-zone'));
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('Enter on the zone opens the file picker', () => {
    render(<FileDropzone onFiles={vi.fn()} />);
    const input = document.querySelector('.jini-file-dropzone__input') as HTMLInputElement;
    const clickSpy = vi.spyOn(input, 'click');
    fireEvent.keyDown(screen.getByTestId('file-dropzone-zone'), { key: 'Enter' });
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('Space on the zone opens the file picker', () => {
    render(<FileDropzone onFiles={vi.fn()} />);
    const input = document.querySelector('.jini-file-dropzone__input') as HTMLInputElement;
    const clickSpy = vi.spyOn(input, 'click');
    fireEvent.keyDown(screen.getByTestId('file-dropzone-zone'), { key: ' ' });
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('a key other than Enter/Space on the zone does nothing', () => {
    render(<FileDropzone onFiles={vi.fn()} />);
    const input = document.querySelector('.jini-file-dropzone__input') as HTMLInputElement;
    const clickSpy = vi.spyOn(input, 'click');
    fireEvent.keyDown(screen.getByTestId('file-dropzone-zone'), { key: 'a' });
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it('drag enter/leave toggles the is-drag-over class on the zone', () => {
    render(<FileDropzone onFiles={vi.fn()} />);
    const zone = screen.getByTestId('file-dropzone-zone');
    expect(zone).not.toHaveClass('is-drag-over');
    fireEvent.dragEnter(zone, { dataTransfer: dataTransfer([]) });
    expect(zone).toHaveClass('is-drag-over');
    fireEvent.dragLeave(zone, { dataTransfer: dataTransfer([]) });
    expect(zone).not.toHaveClass('is-drag-over');
  });

  it('an end-to-end drop stages the dropped files via onFiles', async () => {
    const onFiles = vi.fn();
    render(<FileDropzone onFiles={onFiles} />);
    const zone = screen.getByTestId('file-dropzone-zone');
    const f = file('dropped.png', 'image/png');
    fireEvent.drop(zone, { dataTransfer: dataTransfer([f]) });
    await vi.waitFor(() => expect(onFiles).toHaveBeenCalledWith([f]));
  });

  it('an end-to-end file-input change stages the picked files via onFiles', () => {
    const onFiles = vi.fn();
    render(<FileDropzone onFiles={onFiles} />);
    const input = document.querySelector('.jini-file-dropzone__input') as HTMLInputElement;
    const f = file('picked.txt');
    Object.defineProperty(input, 'files', { value: [f], configurable: true });
    fireEvent.change(input);
    expect(onFiles).toHaveBeenCalledWith([f]);
  });

  it('sets the accept attribute on the native input', () => {
    render(<FileDropzone onFiles={vi.fn()} accept=".fig" />);
    expect(document.querySelector('.jini-file-dropzone__input')).toHaveAttribute('accept', '.fig');
  });

  it('sets webkitdirectory/directory attributes when directory is true', () => {
    render(<FileDropzone onFiles={vi.fn()} directory />);
    const input = document.querySelector('.jini-file-dropzone__input')!;
    expect(input).toHaveAttribute('webkitdirectory');
    expect(input).toHaveAttribute('directory');
  });

  it('omits the directory attributes by default', () => {
    render(<FileDropzone onFiles={vi.fn()} />);
    const input = document.querySelector('.jini-file-dropzone__input')!;
    expect(input).not.toHaveAttribute('webkitdirectory');
  });

  it('renders no browse-folder button by default, and one when onBrowseFolder is supplied', async () => {
    const onBrowseFolder = vi.fn();
    const { rerender } = render(<FileDropzone onFiles={vi.fn()} />);
    expect(screen.queryByText('Browse folder')).not.toBeInTheDocument();
    rerender(<FileDropzone onFiles={vi.fn()} onBrowseFolder={onBrowseFolder} />);
    await userEvent.click(screen.getByText('Browse folder'));
    expect(onBrowseFolder).toHaveBeenCalledTimes(1);
  });

  it('renders no secondary action by default, and one when secondaryAction is supplied', async () => {
    const onClick = vi.fn();
    const { rerender } = render(<FileDropzone onFiles={vi.fn()} />);
    expect(screen.queryByText('Select from library')).not.toBeInTheDocument();
    rerender(<FileDropzone onFiles={vi.fn()} secondaryAction={{ label: 'Select from library', onClick }} />);
    await userEvent.click(screen.getByText('Select from library'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  describe('the simple/names variant', () => {
    it('shows the prompt in the zone (not the names) when onRemoveName is supplied, and a separate removable chip list', async () => {
      const onRemoveName = vi.fn();
      render(
        <FileDropzone
          onFiles={vi.fn()}
          prompt="Choose a folder"
          names={['src/a.ts', 'src/b.ts']}
          onRemoveName={onRemoveName}
          label="Local code"
        />,
      );
      expect(screen.getByText('Choose a folder')).toBeInTheDocument();
      const list = screen.getByLabelText('Local code selections');
      expect(list).toHaveTextContent('src/a.ts');
      await userEvent.click(screen.getByRole('button', { name: 'Remove src/a.ts' }));
      expect(onRemoveName).toHaveBeenCalledWith('src/a.ts');
    });

    it('falls back to a generic "Selections" label with no `label` prop', () => {
      render(<FileDropzone onFiles={vi.fn()} names={['a.fig']} onRemoveName={vi.fn()} />);
      expect(screen.getByLabelText('Selections')).toBeInTheDocument();
    });

    it('shows the comma-joined names directly in the zone text when onRemoveName is omitted, with no chip list', () => {
      render(<FileDropzone onFiles={vi.fn()} names={['a.fig', 'b.fig']} />);
      expect(screen.getByText('a.fig, b.fig')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();
    });

    it('renders nothing extra for an empty names array', () => {
      render(<FileDropzone onFiles={vi.fn()} names={[]} onRemoveName={vi.fn()} prompt="Choose a folder" />);
      expect(screen.getByText('Choose a folder')).toBeInTheDocument();
    });
  });

  describe('the rich/thumbnail-grid variant', () => {
    it('renders staged files as a thumbnail grid, opens the lightbox on select, and closes it on close-button click', async () => {
      const f = file('a.pdf', 'application/pdf');
      render(<FileDropzone onFiles={vi.fn()} files={[f]} onRemove={vi.fn()} />);
      expect(screen.getByText('a.pdf')).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      await userEvent.click(document.querySelector('.jini-file-dropzone__tile-main')!);
      expect(screen.getByRole('dialog', { name: 'a.pdf' })).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Close preview' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('closes the open lightbox on Escape', async () => {
      const f = file('a.pdf', 'application/pdf');
      render(<FileDropzone onFiles={vi.fn()} files={[f]} onRemove={vi.fn()} />);
      await userEvent.click(document.querySelector('.jini-file-dropzone__tile-main')!);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('removing a staged file calls onRemove without opening the lightbox', async () => {
      const onRemove = vi.fn();
      const f = file('a.pdf', 'application/pdf');
      render(<FileDropzone onFiles={vi.fn()} files={[f]} onRemove={onRemove} />);
      await userEvent.click(screen.getByRole('button', { name: 'Remove a.pdf' }));
      expect(onRemove).toHaveBeenCalledWith(f);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('renders no thumbnail grid at all with an empty files array', () => {
      const { container } = render(<FileDropzone onFiles={vi.fn()} files={[]} />);
      expect(container.querySelector('.jini-file-dropzone__grid')).toBeNull();
    });
  });

  it('translates label, prompt, helper, browse-folder, secondary-action, and the zone aria-label end-to-end under I18nProvider', () => {
    render(
      <I18nProvider
        dictionaries={{
          fr: {
            'Local code': 'Code local',
            'Choose a folder': 'Choisir un dossier',
            'Up to 12 MB each': "Jusqu'à 12 Mo chacun",
            'Browse folder': 'Parcourir le dossier',
            'Select from library': 'Choisir dans la bibliothèque',
            'Add files — drag and drop{paste}, or click to browse': 'Ajouter des fichiers — glisser-déposer{paste}',
            ', paste': ', coller',
          },
        }}
        initialLocale="fr"
      >
        <FileDropzone
          onFiles={vi.fn()}
          label="Local code"
          prompt="Choose a folder"
          helper="Up to 12 MB each"
          onBrowseFolder={vi.fn()}
          secondaryAction={{ label: 'Select from library', onClick: vi.fn() }}
          enablePaste
        />
      </I18nProvider>,
    );
    expect(screen.getByText('Code local')).toBeInTheDocument();
    expect(screen.getByText('Choisir un dossier')).toBeInTheDocument();
    expect(screen.getByText("Jusqu'à 12 Mo chacun")).toBeInTheDocument();
    expect(screen.getByText('Parcourir le dossier')).toBeInTheDocument();
    expect(screen.getByText('Choisir dans la bibliothèque')).toBeInTheDocument();
    expect(screen.getByTestId('file-dropzone-zone')).toHaveAttribute(
      'aria-label',
      'Ajouter des fichiers — glisser-déposer, coller',
    );
  });
});

describe('FileDropzone 4-pattern hook override test suite', () => {
  it('Pattern 1 — State 1: Idle state via useFileDropzone hook override', () => {
    const customDropzoneHook = () => ({
      inputRef: { current: null },
      dragOver: false,
      openPicker: vi.fn(),
      onZoneDragEnter: vi.fn(),
      onZoneDragOver: vi.fn(),
      onZoneDragLeave: vi.fn(),
      onZoneDrop: vi.fn(),
      onInputClick: vi.fn(),
      onInputChange: vi.fn(),
    });

    render(<FileDropzone onFiles={vi.fn()} useFileDropzone={customDropzoneHook as any} />);

    const zone = screen.getByTestId('file-dropzone-zone');
    expect(zone).not.toHaveClass('is-drag-over');
  });

  it('Pattern 2 — State 2: Active drag-over state via useFileDropzone hook override', () => {
    const customDropzoneHook = () => ({
      inputRef: { current: null },
      dragOver: true,
      openPicker: vi.fn(),
      onZoneDragEnter: vi.fn(),
      onZoneDragOver: vi.fn(),
      onZoneDragLeave: vi.fn(),
      onZoneDrop: vi.fn(),
      onInputClick: vi.fn(),
      onInputChange: vi.fn(),
    });

    render(<FileDropzone onFiles={vi.fn()} useFileDropzone={customDropzoneHook as any} />);

    const zone = screen.getByTestId('file-dropzone-zone');
    expect(zone).toHaveClass('is-drag-over');
  });

  it('Pattern 3 — State 3: Staged files thumbnail grid via useFileDropzonePreviews hook override', () => {
    const demoFile = new File(['content'], 'demo.png', { type: 'image/png' });
    const customPreviewsHook = () => ({
      previewUrls: new Map([[demoFile, 'blob:demo']]),
      fontFamilies: new Map(),
      textSnippets: new Map(),
    });

    const { container } = render(
      <FileDropzone
        onFiles={vi.fn()}
        files={[demoFile]}
        useFileDropzonePreviews={customPreviewsHook as any}
      />,
    );

    expect(screen.getByText('demo.png')).toBeInTheDocument();
    // The caption renders regardless of preview state — assert on the
    // actual thumbnail `<img>` src too, so a broken/unwired previews hook
    // (e.g. one that never reaches the thumbnail grid) would fail this test.
    const thumb = container.querySelector('img.jini-file-dropzone__thumb');
    expect(thumb).toHaveAttribute('src', 'blob:demo');
  });

  it('Pattern 4 — State 4: Dynamic staged names state transition walkthrough using React useState inside test harness', () => {
    function DynamicDropzoneHarness() {
      const [names, setNames] = useState<string[]>([]);
      return (
        <div>
          <button type="button" onClick={() => setNames(['doc.pdf'])}>
            Stage file
          </button>
          <FileDropzone onFiles={vi.fn()} names={names} onRemoveName={() => setNames([])} />
        </div>
      );
    }

    render(<DynamicDropzoneHarness />);

    expect(screen.queryByText('doc.pdf')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Stage file' }));

    expect(screen.getByText('doc.pdf')).toBeInTheDocument();
  });
});
