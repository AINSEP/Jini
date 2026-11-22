// @vitest-environment jsdom
import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider, type TranslationDict, type useT } from '../../../../i18n/index.js';
import { AssetTreeBreadcrumbs } from '../../../react/components/AssetTreeBreadcrumbs.js';
import { AssetTreeEmptyState } from '../../../react/components/AssetTreeEmptyState.js';
import { AssetTreeFileRow } from '../../../react/components/AssetTreeFileRow.js';
import { AssetTreeFolderRow } from '../../../react/components/AssetTreeFolderRow.js';
import { AssetTreeRowMenu } from '../../../react/components/AssetTreeRowMenu.js';
import { AssetTreeSelectionBar } from '../../../react/components/AssetTreeSelectionBar.js';
import { AssetTreeToolbar } from '../../../react/components/AssetTreeToolbar.js';
import { AssetTreeUploadErrorBanner } from '../../../react/components/AssetTreeUploadErrorBanner.js';
import { FilePreviewPane } from '../../../react/components/FilePreviewPane.js';

/** A translator that is visibly not the key, so the assertion proves the injected hook ran. */
const useQuotingT: typeof useT = () => (key) => `«${key}»`;

const FR: TranslationDict = {
  Breadcrumbs: 'Fil d’Ariane',
  'No files yet': 'Aucun fichier',
  '{n} files': '{n} fichiers',
  Open: 'Ouvrir',
  '{n} selected': '{n} sélectionnés',
  Dismiss: 'Fermer',
  'Close preview': 'Fermer l’aperçu',
  'Select {name}': 'Sélectionner {name}',
  Upload: 'Téléverser',
};

function inFrench(ui: React.ReactNode) {
  return <I18nProvider dictionaries={{ fr: FR }} initialLocale="fr">{ui}</I18nProvider>;
}

const noop = vi.fn();
const fileRowProps = {
  path: 'a.txt',
  displayName: 'a.txt',
  active: false,
  selected: false,
  kindLabel: 'Text',
  kindGlyph: '¶',
  size: 512,
  modifiedAt: Date.now() - 1000,
  renaming: null,
  onSelectPreview: noop,
  onOpen: noop,
  onToggleSelect: noop,
  onOpenMenu: noop,
  onRenameDraftChange: noop,
  onCommitRename: noop,
  onCancelRename: noop,
};
const menuProps = {
  path: 'a.txt',
  displayName: 'a.txt',
  top: 10,
  left: 20,
  containerRef: createRef<HTMLDivElement>(),
  canCopyLocalPath: true,
  copied: false,
  onOpen: noop,
  onRename: noop,
  onCopyLocalPath: noop,
  onDelete: noop,
};
const previewProps = {
  file: { path: 'dir/a.txt' },
  path: 'dir/a.txt',
  kindLabel: 'Text',
  kindGlyph: '¶',
  size: 2048,
  modifiedAt: Date.now() - 5000,
  onOpen: noop,
  onClose: noop,
};

describe('AssetTreeBreadcrumbs translation hook', () => {
  it('renders the translator supplied through useTHook', () => {
    render(<AssetTreeBreadcrumbs currentDir="" rootLabel="My Project" onNavigate={noop} useTHook={useQuotingT} />);
    expect(screen.getByRole('navigation', { name: '«Breadcrumbs»' })).toBeInTheDocument();
  });

  it('renders the translated label from the real provider, not the key', () => {
    render(inFrench(<AssetTreeBreadcrumbs currentDir="" rootLabel="My Project" onNavigate={noop} />));
    expect(screen.getByRole('navigation', { name: 'Fil d’Ariane' })).toBeInTheDocument();
  });
});

describe('AssetTreeEmptyState translation hook', () => {
  it('renders the translator supplied through useTHook', () => {
    render(<AssetTreeEmptyState useTHook={useQuotingT} />);
    expect(screen.getByText('«No files yet»')).toBeInTheDocument();
  });

  it('renders the translated title from the real provider, not the key', () => {
    render(inFrench(<AssetTreeEmptyState />));
    expect(screen.getByText('Aucun fichier')).toBeInTheDocument();
  });
});

describe('AssetTreeFolderRow translation hook', () => {
  it('renders the translator supplied through useTHook', () => {
    render(<AssetTreeFolderRow name="dir" path="dir" fileCount={3} onNavigate={noop} useTHook={useQuotingT} />);
    expect(screen.getByText('«{n} files»')).toBeInTheDocument();
  });

  it('renders the translated, interpolated count from the real provider, not the key', () => {
    render(inFrench(<AssetTreeFolderRow name="dir" path="dir" fileCount={3} onNavigate={noop} />));
    expect(screen.getByText('3 fichiers')).toBeInTheDocument();
  });
});

describe('AssetTreeFileRow translation hook', () => {
  it('renders the translated row checkbox label from the real provider, not the key', () => {
    render(inFrench(<AssetTreeFileRow {...fileRowProps} />));
    expect(screen.getByRole('checkbox', { name: 'Sélectionner a.txt' })).toBeInTheDocument();
  });
});

describe('AssetTreeRowMenu translation hook', () => {
  it('renders the translator supplied through useTHook', () => {
    render(<AssetTreeRowMenu {...menuProps} useTHook={useQuotingT} />);
    expect(screen.getByRole('button', { name: '«Open»' })).toBeInTheDocument();
  });

  it('renders the translated item from the real provider, not the key', () => {
    render(inFrench(<AssetTreeRowMenu {...menuProps} />));
    expect(screen.getByRole('button', { name: 'Ouvrir' })).toBeInTheDocument();
  });
});

describe('AssetTreeSelectionBar translation hook', () => {
  it('renders the translator supplied through useTHook', () => {
    render(<AssetTreeSelectionBar count={3} onClear={noop} onDelete={noop} deleting={false} useTHook={useQuotingT} />);
    expect(screen.getByText('«{n} selected»')).toBeInTheDocument();
  });

  it('renders the translated, interpolated count from the real provider, not the key', () => {
    render(inFrench(<AssetTreeSelectionBar count={3} onClear={noop} onDelete={noop} deleting={false} />));
    expect(screen.getByText('3 sélectionnés')).toBeInTheDocument();
  });
});

describe('AssetTreeToolbar translation hook', () => {
  const actions = [{ key: 'upload', label: 'Upload', icon: 'upload', onSelect: noop }];

  it('renders the translator supplied through useTHook', () => {
    render(<AssetTreeToolbar actions={actions} useTHook={useQuotingT} />);
    expect(screen.getByRole('button', { name: '«Upload»' })).toBeInTheDocument();
  });

  it('renders the translated action label from the real provider, not the key', () => {
    render(inFrench(<AssetTreeToolbar actions={actions} />));
    expect(screen.getByRole('button', { name: 'Téléverser' })).toBeInTheDocument();
  });
});

describe('AssetTreeUploadErrorBanner translation hook', () => {
  it('renders the translator supplied through useTHook', () => {
    render(<AssetTreeUploadErrorBanner message="Could not read." onDismiss={noop} useTHook={useQuotingT} />);
    expect(screen.getByRole('button', { name: '«Dismiss»' })).toBeInTheDocument();
  });

  it('renders the translated button from the real provider, not the key', () => {
    render(inFrench(<AssetTreeUploadErrorBanner message="Could not read." onDismiss={noop} />));
    expect(screen.getByRole('button', { name: 'Fermer' })).toBeInTheDocument();
  });
});

describe('FilePreviewPane translation hook', () => {
  it('renders the translator supplied through useTHook', () => {
    render(<FilePreviewPane {...previewProps} useTHook={useQuotingT} />);
    expect(screen.getByRole('button', { name: '«Close preview»' })).toBeInTheDocument();
  });

  it('renders the translated button from the real provider, not the key', () => {
    render(inFrench(<FilePreviewPane {...previewProps} />));
    expect(screen.getByRole('button', { name: 'Fermer l’aperçu' })).toBeInTheDocument();
  });
});
