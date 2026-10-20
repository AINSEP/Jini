// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AssetTreeBrowser, type AssetTreeBrowserProps } from '../../../react/components/AssetTreeBrowser.js';
import { createFakeAssetTreeDependencies } from '../../../dependencies.js';
import { I18nProvider } from '../../../../i18n/index.js';
import type { AssetTreeFolderItem, AssetTreeSelectors } from '../../../types.js';

interface TestFile {
  path: string;
  kind: string;
  size: number;
  mtime: number;
  localPath?: string | null;
}

const NOW = 1_700_000_000_000;

function makeFiles(): TestFile[] {
  return [
    { path: 'readme.txt', kind: 'text', size: 100, mtime: NOW - 1_000, localPath: null },
    { path: 'photo.png', kind: 'image', size: 2048, mtime: NOW - 2_000, localPath: '/Users/me/photo.png' },
    { path: 'docs/spec.md', kind: 'text', size: 300, mtime: NOW - 3_000, localPath: null },
  ];
}

const folders: AssetTreeFolderItem[] = [{ path: 'empty' }];

const selectors: AssetTreeSelectors<TestFile> = {
  getSize: (f) => f.size,
  getModifiedAt: (f) => f.mtime,
  getKind: (f) => f.kind,
  getLocalPath: (f) => f.localPath,
};

const kindConfig = {
  text: { label: 'Text file', glyph: '¶' },
  image: { label: 'Image', glyph: '▣' },
};

function baseProps(overrides: Partial<Parameters<typeof AssetTreeBrowser<TestFile>>[0]> = {}) {
  return {
    files: makeFiles(),
    folders,
    selectors,
    kindConfig,
    dependencies: createFakeAssetTreeDependencies(),
    onOpenFile: vi.fn(),
    onRenameFile: vi.fn(),
    onDeleteFile: vi.fn(),
    onDeleteFiles: vi.fn(),
    onUploadFiles: vi.fn(),
    ...overrides,
  };
}

/**
 * A minimal stateful host wrapper: owns `files` itself and applies a
 * successful rename to it, exactly like a real host would (the origin
 * `DesignFilesPanel` never owns its own file list — its `files` prop comes
 * from the parent, which is expected to update it after a rename resolves).
 * `AssetTreeBrowser` itself never mutates `files` — only its own preview/
 * selection paths — so a rename test against a STATIC `files` array would
 * incorrectly show the preview closing (the renamed path no longer matches
 * any entry in `files`) even though the rename genuinely succeeded.
 */
function RenameHarness(props: Omit<AssetTreeBrowserProps<TestFile>, 'files' | 'onRenameFile'>) {
  const [files, setFiles] = useState<TestFile[]>(makeFiles());
  return (
    <AssetTreeBrowser
      {...props}
      files={files}
      onRenameFile={(path, nextPath) => {
        const target = files.find((f) => f.path === path);
        if (!target) return null;
        const renamed: TestFile = { ...target, path: nextPath };
        setFiles((prev) => [...prev.filter((f) => f.path !== path), renamed]);
        return renamed;
      }}
    />
  );
}

describe('AssetTreeBrowser', () => {
  it('renders the Folders section and kind sections at the root', () => {
    render(<AssetTreeBrowser {...baseProps()} />);
    expect(screen.getByText('Folders')).toBeInTheDocument();
    expect(screen.getByTestId('asset-tree-dir-row-docs')).toBeInTheDocument();
    expect(screen.getByTestId('asset-tree-dir-row-empty')).toBeInTheDocument();
    expect(screen.getByText('Text file', { selector: '.asset-tree-section-label' })).toBeInTheDocument();
    expect(screen.getByText('Image', { selector: '.asset-tree-section-label' })).toBeInTheDocument();
    expect(screen.getByTestId('asset-tree-file-row-readme.txt')).toBeInTheDocument();
    expect(screen.getByTestId('asset-tree-file-row-photo.png')).toBeInTheDocument();
  });

  it('shows the empty state when there are no files or folders', () => {
    render(<AssetTreeBrowser {...baseProps({ files: [], folders: [] })} />);
    expect(screen.getByTestId('asset-tree-empty')).toBeInTheDocument();
  });

  it('navigates into a folder via breadcrumbs and back to root', async () => {
    render(<AssetTreeBrowser {...baseProps()} rootLabel="My Project" />);
    await userEvent.click(screen.getByTestId('asset-tree-dir-row-docs'));
    expect(screen.getByTestId('asset-tree-file-row-docs/spec.md')).toBeInTheDocument();
    expect(screen.queryByTestId('asset-tree-file-row-readme.txt')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'My Project' }));
    expect(screen.getByTestId('asset-tree-file-row-readme.txt')).toBeInTheDocument();
  });

  it('reports navigation via onNavStateChange', async () => {
    const onNavStateChange = vi.fn();
    render(<AssetTreeBrowser {...baseProps({ onNavStateChange })} />);
    await userEvent.click(screen.getByTestId('asset-tree-dir-row-docs'));
    expect(onNavStateChange).toHaveBeenCalledWith({ currentDir: 'docs' });
  });

  it('opens the preview pane on clicking a file name, and Open triggers onOpenFile', async () => {
    const onOpenFile = vi.fn();
    render(<AssetTreeBrowser {...baseProps({ onOpenFile })} />);
    await userEvent.click(screen.getByTestId('asset-tree-file-row-readme.txt').querySelector('.asset-tree-row-name')!);
    expect(screen.getByTestId('asset-tree-preview')).toBeInTheDocument();
    await userEvent.click(within(screen.getByTestId('asset-tree-preview')).getByRole('button', { name: 'Open' }));
    expect(onOpenFile).toHaveBeenCalledWith(expect.objectContaining({ path: 'readme.txt' }));
  });

  it('selecting rows shows the selection bar with the right count, and Clear hides it', async () => {
    const onSelectionChange = vi.fn();
    render(<AssetTreeBrowser {...baseProps({ onSelectionChange })} />);
    await userEvent.click(within(screen.getByTestId('asset-tree-file-row-readme.txt')).getByRole('checkbox'));
    expect(screen.getByTestId('asset-tree-batch-bar')).toBeInTheDocument();
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    expect(onSelectionChange).toHaveBeenCalledWith(new Set(['readme.txt']));
    await userEvent.click(within(screen.getByTestId('asset-tree-file-row-photo.png')).getByRole('checkbox'));
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.queryByTestId('asset-tree-batch-bar')).toBeNull();
  });

  it('batch delete calls onDeleteFiles with the selected paths', async () => {
    const onDeleteFiles = vi.fn().mockResolvedValue(undefined);
    render(<AssetTreeBrowser {...baseProps({ onDeleteFiles })} />);
    await userEvent.click(within(screen.getByTestId('asset-tree-file-row-readme.txt')).getByRole('checkbox'));
    await userEvent.click(within(screen.getByTestId('asset-tree-file-row-photo.png')).getByRole('checkbox'));
    await userEvent.click(screen.getByTestId('asset-tree-batch-delete'));
    expect(onDeleteFiles).toHaveBeenCalledWith(expect.arrayContaining(['readme.txt', 'photo.png']));
  });

  it('hides the batch-download action when downloadFiles is omitted, shows it when supplied', async () => {
    const { rerender } = render(<AssetTreeBrowser {...baseProps()} />);
    await userEvent.click(within(screen.getByTestId('asset-tree-file-row-readme.txt')).getByRole('checkbox'));
    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull();

    // Selection persists across this rerender (same mounted instance) — no need to click again.
    const downloadFiles = vi.fn().mockResolvedValue({ blob: new Blob(['x']), filename: 'archive.zip' });
    rerender(<AssetTreeBrowser {...baseProps({ downloadFiles })} />);
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
  });

  it('opens the row menu and Delete calls onDeleteFile with the path', async () => {
    const onDeleteFile = vi.fn();
    render(<AssetTreeBrowser {...baseProps({ onDeleteFile })} />);
    await userEvent.click(screen.getByTestId('asset-tree-file-menu-readme.txt'));
    expect(screen.getByTestId('asset-tree-row-menu-popover')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('asset-tree-row-delete-readme.txt'));
    expect(onDeleteFile).toHaveBeenCalledWith('readme.txt');
    expect(screen.queryByTestId('asset-tree-row-menu-popover')).toBeNull();
  });

  it('the row menu Open action resolves the file and calls onOpenFile', async () => {
    const onOpenFile = vi.fn();
    render(<AssetTreeBrowser {...baseProps({ onOpenFile })} />);
    await userEvent.click(screen.getByTestId('asset-tree-file-menu-readme.txt'));
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(onOpenFile).toHaveBeenCalledWith(expect.objectContaining({ path: 'readme.txt' }));
  });

  it('gates copy-local-path on the selectors.getLocalPath result: disabled for readme.txt, enabled for photo.png', async () => {
    render(<AssetTreeBrowser {...baseProps()} />);
    await userEvent.click(screen.getByTestId('asset-tree-file-menu-readme.txt'));
    expect(screen.getByRole('button', { name: 'Copy local path' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');

    await userEvent.click(screen.getByTestId('asset-tree-file-menu-photo.png'));
    const copyButton = screen.getByRole('button', { name: 'Copy local path' });
    expect(copyButton).not.toBeDisabled();
    await userEvent.click(copyButton);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument());
  });

  it('hides the row menu Download action when getFileUrl is omitted, shows it when supplied', async () => {
    const { rerender } = render(<AssetTreeBrowser {...baseProps()} />);
    await userEvent.click(screen.getByTestId('asset-tree-file-menu-readme.txt'));
    expect(screen.queryByRole('link')).toBeNull();

    rerender(<AssetTreeBrowser {...baseProps({ getFileUrl: (f: TestFile) => `/files/${f.path}` })} />);
    await userEvent.click(screen.getByTestId('asset-tree-file-menu-readme.txt'));
    expect(screen.getByRole('link')).toHaveAttribute('href', '/files/readme.txt');
  });

  it('renames a file, carrying an active selection and preview over to the new path', async () => {
    render(<RenameHarness {...baseProps()} />);

    // Select and preview readme.txt first.
    await userEvent.click(within(screen.getByTestId('asset-tree-file-row-readme.txt')).getByRole('checkbox'));
    await userEvent.click(screen.getByTestId('asset-tree-file-row-readme.txt').querySelector('.asset-tree-row-name')!);
    expect(screen.getByTestId('asset-tree-preview')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('asset-tree-file-menu-readme.txt'));
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('readme.txt');
    await userEvent.clear(input);
    await userEvent.type(input, 'renamed.txt{Enter}');

    await waitFor(() => expect(screen.getByTestId('asset-tree-file-row-renamed.txt')).toBeInTheDocument());
    // Selection carried over: still exactly one row selected, under the new path.
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    expect(within(screen.getByTestId('asset-tree-file-row-renamed.txt')).getByRole('checkbox')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    // Preview carried over too: still open, now showing the new path.
    expect(screen.getByTestId('asset-tree-preview')).toHaveTextContent('renamed.txt');
  });

  it('renders the reloading overlay while reloading is true', () => {
    render(<AssetTreeBrowser {...baseProps({ reloading: true })} />);
    expect(screen.getByTestId('asset-tree-reloading')).toBeInTheDocument();
  });

  it('renders and wires toolbarActions', async () => {
    const onSelect = vi.fn();
    render(
      <AssetTreeBrowser
        {...baseProps({ toolbarActions: [{ key: 'new', label: 'New File', onSelect, testId: 'toolbar-new' }] })}
      />,
    );
    await userEvent.click(screen.getByTestId('toolbar-new'));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('renders and wires emptyStateActions', async () => {
    const onSelect = vi.fn();
    render(
      <AssetTreeBrowser
        {...baseProps({
          files: [],
          folders: [],
          emptyStateActions: [{ key: 'new', label: 'New File', onSelect, testId: 'empty-new' }],
        })}
      />,
    );
    await userEvent.click(screen.getByTestId('empty-new'));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('shows each kind section\'s file count next to its label (root counts nested files too)', () => {
    render(<AssetTreeBrowser {...baseProps()} />);
    const textLabel = screen.getByText('Text file', { selector: '.asset-tree-section-label' });
    const imageLabel = screen.getByText('Image', { selector: '.asset-tree-section-label' });
    expect(textLabel.querySelector('.asset-tree-section-count')).toHaveTextContent('2');
    expect(imageLabel.querySelector('.asset-tree-section-count')).toHaveTextContent('1');
  });

  it('keeps the preview thumbnail\'s click-to-open overlay by default', () => {
    const selectInitialPreviewFile = (files: TestFile[]) => files[0] ?? null;
    render(<AssetTreeBrowser {...baseProps({ selectInitialPreviewFile })} />);
    expect(screen.getByTestId('asset-tree-preview').querySelector('.asset-tree-preview-thumb-open')).not.toBeNull();
  });

  it('drops the preview thumbnail\'s click-to-open overlay when thumbnailIsInteractive is true', () => {
    const selectInitialPreviewFile = (files: TestFile[]) => files[0] ?? null;
    render(<AssetTreeBrowser {...baseProps({ selectInitialPreviewFile, thumbnailIsInteractive: true })} />);
    expect(screen.getByTestId('asset-tree-preview').querySelector('.asset-tree-preview-thumb-open')).toBeNull();
  });

  it('renders a host-supplied footer', () => {
    render(<AssetTreeBrowser {...baseProps({ footer: <div data-testid="host-footer">footer</div> })} />);
    expect(screen.getByTestId('host-footer')).toBeInTheDocument();
  });

  it('applies an auto-selected initial preview via selectInitialPreviewFile', () => {
    const selectInitialPreviewFile = (files: TestFile[]) => files.find((f) => f.path === 'photo.png') ?? null;
    render(<AssetTreeBrowser {...baseProps({ selectInitialPreviewFile })} />);
    expect(screen.getByTestId('asset-tree-preview')).toHaveTextContent('photo.png');
  });

  it('shows a drag overlay while a file is being dragged over the body, and uploads on drop', async () => {
    const onUploadFiles = vi.fn();
    render(<AssetTreeBrowser {...baseProps({ onUploadFiles })} />);
    const body = screen.getByTestId('asset-tree-body');
    const file = new File(['x'], 'dropped.txt');
    fireEvent.dragEnter(body, { dataTransfer: { items: [], files: [] } });
    expect(screen.getByTestId('asset-tree-drop-overlay')).toBeInTheDocument();
    fireEvent.drop(body, { dataTransfer: { items: [], files: [file] } });
    expect(screen.queryByTestId('asset-tree-drop-overlay')).toBeNull();
    await waitFor(() => expect(onUploadFiles).toHaveBeenCalledWith([file]));
  });

  it('renders translated copy when mounted under an I18nProvider with a matching dictionary', () => {
    render(
      <I18nProvider dictionaries={{ fr: { Files: 'Fichiers', Folders: 'Dossiers' } }} initialLocale="fr">
        <AssetTreeBrowser {...baseProps()} />
      </I18nProvider>,
    );
    expect(screen.getByText('Fichiers')).toBeInTheDocument();
    expect(screen.getByText('Dossiers')).toBeInTheDocument();
  });

  it('falls back to real browser dependencies when dependencies is omitted', () => {
    const props = baseProps();
    const withoutDependencies = { ...props };
    delete (withoutDependencies as { dependencies?: unknown }).dependencies;
    // No dependencies prop at all — AssetTreeBrowser must default to
    // `createBrowserAssetTreeDependencies()` internally rather than crash.
    expect(() => render(<AssetTreeBrowser {...withoutDependencies} />)).not.toThrow();
    expect(screen.getByTestId('asset-tree-file-row-readme.txt')).toBeInTheDocument();
  });

  it('renders with folders entirely omitted (not just empty), files still visible', () => {
    const props = baseProps();
    const withoutFolders = { ...props };
    delete (withoutFolders as { folders?: unknown }).folders;
    render(<AssetTreeBrowser {...withoutFolders} />);
    expect(screen.getByTestId('asset-tree-file-row-readme.txt')).toBeInTheDocument();
  });

  it('treats an omitted `folders` the same as an empty one for the empty-state check (only reachable with files also empty, since `isEmpty` short-circuits on files.length first)', () => {
    const props = baseProps();
    const withoutFolders = { ...props, files: [] };
    delete (withoutFolders as { folders?: unknown }).folders;
    render(<AssetTreeBrowser {...withoutFolders} />);
    expect(screen.getByTestId('asset-tree-empty')).toBeInTheDocument();
  });

  it('clicking the batch-download button drives downloadFiles through to completion', async () => {
    const downloadFiles = vi.fn().mockResolvedValue({ blob: new Blob(['x']), filename: 'archive.zip' });
    render(<AssetTreeBrowser {...baseProps({ downloadFiles })} />);
    await userEvent.click(within(screen.getByTestId('asset-tree-file-row-readme.txt')).getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(downloadFiles).toHaveBeenCalledWith(['readme.txt']));
  });

  it('the row menu tolerates its target file vanishing from `files` while still open: no crash, copy-local-path disabled, download hidden, copy click no-ops', async () => {
    const getFileUrl = (f: TestFile) => `/files/${f.path}`;
    const { rerender } = render(<AssetTreeBrowser {...baseProps({ getFileUrl })} />);
    await userEvent.click(screen.getByTestId('asset-tree-file-menu-photo.png'));
    expect(screen.getByRole('button', { name: 'Copy local path' })).not.toBeDisabled();
    expect(screen.getByRole('link')).toBeInTheDocument();

    // 'photo.png' drops out of `files` (e.g. the host deleted it elsewhere)
    // while the row menu is still open for it — the popover itself isn't
    // tied to `files`, so `menuPos` survives; only the resolved file goes
    // missing.
    rerender(<AssetTreeBrowser {...baseProps({ getFileUrl, files: makeFiles().filter((f) => f.path !== 'photo.png') })} />);
    expect(screen.getByTestId('asset-tree-row-menu-popover')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy local path' })).toBeDisabled();
    expect(screen.queryByRole('link')).toBeNull();
    await expect(userEvent.click(screen.getByRole('button', { name: 'Copy local path' }))).resolves.not.toThrow();
  });

  it('shows the upload-error banner for a failed drop, and hides it once a preview opens even though the error is still set', async () => {
    render(<AssetTreeBrowser {...baseProps()} />);
    const body = screen.getByTestId('asset-tree-body');
    const failingEntry = {
      isFile: false,
      isDirectory: true,
      createReader: () => ({
        readEntries: (_success: (entries: FileSystemEntry[]) => void, error: (err: DOMException) => void) => {
          error(new DOMException('boom'));
        },
      }),
    };
    const item = { kind: 'file', webkitGetAsEntry: () => failingEntry };
    fireEvent.drop(body, { dataTransfer: { items: [item], files: [] } });
    await waitFor(() => expect(screen.getByTestId('asset-tree-upload-error-banner')).toBeInTheDocument());

    await userEvent.click(screen.getByTestId('asset-tree-file-row-readme.txt').querySelector('.asset-tree-row-name')!);
    expect(screen.getByTestId('asset-tree-preview')).toBeInTheDocument();
    expect(screen.queryByTestId('asset-tree-upload-error-banner')).toBeNull();
  });

  it('renders a nested folder correctly scoped once navigated into its parent directory', async () => {
    const files = [...makeFiles(), { path: 'docs/inner/note.txt', kind: 'text', size: 10, mtime: NOW - 500 }];
    render(<AssetTreeBrowser {...baseProps({ files })} />);
    await userEvent.click(screen.getByTestId('asset-tree-dir-row-docs'));
    expect(screen.getByTestId('asset-tree-dir-row-docs/inner')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('asset-tree-dir-row-docs/inner'));
    expect(screen.getByTestId('asset-tree-file-row-docs/inner/note.txt')).toBeInTheDocument();
  });

  it('shows a download link in the preview pane when getFileUrl is supplied while a file is previewed', async () => {
    render(<AssetTreeBrowser {...baseProps({ getFileUrl: (f: TestFile) => `/files/${f.path}` })} />);
    await userEvent.click(screen.getByTestId('asset-tree-file-row-readme.txt').querySelector('.asset-tree-row-name')!);
    const preview = screen.getByTestId('asset-tree-preview');
    expect(within(preview).getByRole('link', { name: /Download/ })).toHaveAttribute('href', '/files/readme.txt');
  });
});

describe('AssetTreeBrowser hook override 4-pattern test suite', () => {
  it('Pattern 1 — State 1: Default/empty directory state via hook overrides', () => {
    const customNavHook = () => ({
      currentDir: '',
      breadcrumbs: [{ path: '', label: 'Files' }],
      filesAtCurrentDir: [],
      foldersAtCurrentDir: [],
      dirsAtCurrentDir: [],
      groupedSections: [],
      sections: [],
      navigateToDir: vi.fn(),
      setCurrentDir: vi.fn(),
    });

    const customSelectionHook = () => ({
      selected: new Set<string>(),
      toggleSelect: vi.fn(),
      clearSelection: vi.fn(),
      renamePath: vi.fn(),
    });

    render(
      <AssetTreeBrowser
        {...baseProps({
          files: [],
          folders: [],
          useAssetTreeNavigation: customNavHook as any,
          useAssetTreeSelection: customSelectionHook as any,
        })}
      />,
    );

    expect(screen.getByTestId('asset-tree-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('asset-tree-selection-bar')).toBeNull();
  });

  it('Pattern 2 — State 2: Navigated subdirectory view state with breadcrumb interactions', () => {
    const mockSetCurrentDir = vi.fn();
    const sec = [{ kind: 'text', label: 'Text', files: [makeFiles()[0]!] }];
    const customNavHook = () => ({
      currentDir: 'sub/folder',
      breadcrumbs: [
        { path: '', label: 'Files' },
        { path: 'sub', label: 'sub' },
        { path: 'sub/folder', label: 'folder' },
      ],
      filesAtCurrentDir: [makeFiles()[0]!],
      foldersAtCurrentDir: [],
      dirsAtCurrentDir: [],
      groupedSections: sec,
      sections: sec,
      navigateToDir: vi.fn(),
      setCurrentDir: mockSetCurrentDir,
    });

    const customSelectionHook = () => ({
      selected: new Set<string>(),
      toggleSelect: vi.fn(),
      clearSelection: vi.fn(),
      renamePath: vi.fn(),
    });

    render(
      <AssetTreeBrowser
        {...baseProps({
          useAssetTreeNavigation: customNavHook as any,
          useAssetTreeSelection: customSelectionHook as any,
        })}
      />,
    );

    const subButton = screen.getByRole('button', { name: 'sub' });
    expect(subButton).toBeInTheDocument();

    fireEvent.click(subButton);
    expect(mockSetCurrentDir).toHaveBeenCalledWith('sub');
  });

  it('Pattern 3 — State 3: Multi-selection bar state with clear action callback', () => {
    const mockClearSelection = vi.fn();
    const selectedSet = new Set(['readme.txt', 'photo.png']);
    const customSelectionHook = () => ({
      selected: selectedSet,
      toggleSelect: vi.fn(),
      clearSelection: mockClearSelection,
      renamePath: vi.fn(),
    });

    const sec = [{ kind: 'text', label: 'Text', files: makeFiles() }];
    const customNavHook = () => ({
      currentDir: '',
      breadcrumbs: [{ path: '', label: 'Files' }],
      filesAtCurrentDir: makeFiles(),
      foldersAtCurrentDir: [],
      dirsAtCurrentDir: [],
      groupedSections: sec,
      sections: sec,
      navigateToDir: vi.fn(),
      setCurrentDir: vi.fn(),
    });

    render(
      <AssetTreeBrowser
        {...baseProps({
          useAssetTreeNavigation: customNavHook as any,
          useAssetTreeSelection: customSelectionHook as any,
        })}
      />,
    );

    expect(screen.getByText('2 selected')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(mockClearSelection).toHaveBeenCalledTimes(1);
  });

  it('Pattern 4 — State 4: Dynamic full state transition walkthrough using React useState inside hook override', () => {
    function useTestDynamicNavigation() {
      const [currentDir, setCurrentDir] = useState('docs');
      const breadcrumbs = [
        { path: '', label: 'Files' },
        { path: 'docs', label: 'docs' },
      ];
      const filesAtCurrentDir = makeFiles();
      const sec = [{ kind: 'text', label: 'Text', files: filesAtCurrentDir }];

      return {
        currentDir,
        breadcrumbs,
        filesAtCurrentDir,
        foldersAtCurrentDir: [],
        dirsAtCurrentDir: [],
        groupedSections: sec,
        sections: sec,
        navigateToDir: (dir: string) => setCurrentDir(dir),
        setCurrentDir: (dir: string) => setCurrentDir(dir),
      };
    }

    const customSelectionHook = () => ({
      selected: new Set<string>(),
      toggleSelect: vi.fn(),
      clearSelection: vi.fn(),
      renamePath: vi.fn(),
    });

    render(
      <AssetTreeBrowser
        {...baseProps({
          useAssetTreeNavigation: useTestDynamicNavigation as any,
          useAssetTreeSelection: customSelectionHook as any,
        })}
      />,
    );

    // Initial navigated state with breadcrumb button
    const filesBtn = screen.getByRole('button', { name: 'Files' });
    expect(filesBtn).toBeInTheDocument();
    fireEvent.click(filesBtn);
  });

  it('Pattern 5 — State 5: Active preview pane via useAssetTreePreview hook override', () => {
    const files = makeFiles();
    const previewedFile = files[0]!;
    const mockClearPreview = vi.fn();
    const customPreviewHook = () => ({
      previewPath: previewedFile.path,
      previewFile: previewedFile,
      setPreviewPath: vi.fn(),
      clearPreview: mockClearPreview,
    });

    render(
      <AssetTreeBrowser
        {...baseProps({
          files,
          useAssetTreePreview: customPreviewHook as any,
        })}
      />,
    );

    const preview = screen.getByTestId('asset-tree-preview');
    expect(preview).toBeInTheDocument();
    expect(screen.getByTestId(`asset-tree-file-row-${previewedFile.path}`)).toHaveClass('active');

    fireEvent.click(within(preview).getByRole('button', { name: 'Close preview' }));
    expect(mockClearPreview).toHaveBeenCalledTimes(1);
  });

  it('Pattern 6 — State 6: Active inline rename via useAssetTreeRename hook override', () => {
    const files = makeFiles();
    const targetPath = files[0]!.path;
    const mockUpdateDraft = vi.fn();
    const mockCommitRename = vi.fn();
    const mockCancelRename = vi.fn();
    const customRenameHook = () => ({
      renaming: { path: targetPath, draft: 'renamed-draft', saving: false },
      renameError: null,
      startRename: vi.fn(),
      updateDraft: mockUpdateDraft,
      commitRename: mockCommitRename,
      cancelRename: mockCancelRename,
    });

    render(
      <AssetTreeBrowser
        {...baseProps({
          files,
          useAssetTreeRename: customRenameHook as any,
        })}
      />,
    );

    const input = screen.getByRole('textbox', { name: `Rename ${targetPath}` });
    expect(input).toHaveValue('renamed-draft');

    fireEvent.change(input, { target: { value: 'renamed-draft-2' } });
    expect(mockUpdateDraft).toHaveBeenCalledWith('renamed-draft-2');

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockCommitRename).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(mockCancelRename).toHaveBeenCalledTimes(1);
  });
});
