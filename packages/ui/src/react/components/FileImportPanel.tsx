// File/folder picker card with a title, body copy, a native file input, and
// an import button that flips to a working/busy label. Origin:
// `FileImportPanel` in `PluginsView.tsx` (OD) — the origin
// hardcoded its "Import"/"Importing…" button copy directly in JSX (title/
// body/fileLabel were already caller-supplied props); that copy now goes
// through `useT()` per this package's i18n policy. See
// archived UI source map.

import { useT } from '../../features/i18n/index.js';

export interface FileImportPanelProps {
  title: string;
  body: string;
  accept?: string;
  working: boolean;
  fileLabel: string;
  /** Renders a folder picker (`webkitdirectory`) instead of a single-file picker. */
  folder?: boolean;
  canSubmit: boolean;
  onChange: (files: File[]) => void;
  onImport: () => void;
  className?: string;
}

export function FileImportPanel({
  title,
  body,
  accept,
  working,
  fileLabel,
  folder,
  canSubmit,
  onChange,
  onImport,
  className,
}: FileImportPanelProps) {
  const t = useT();
  const directoryProps = folder
    ? ({ webkitdirectory: '', directory: '' } as Record<string, string>)
    : {};
  return (
    <section className={['plugins-view__install-card', className].filter(Boolean).join(' ')}>
      <div>
        <h3>{title}</h3>
        <p>{body}</p>
      </div>
      <label className="plugins-import-modal__file">
        <input
          type="file"
          data-testid={folder ? 'plugins-folder-input' : 'plugins-zip-input'}
          {...(accept ? { accept } : {})}
          {...directoryProps}
          multiple={folder}
          disabled={working}
          onChange={(event) => onChange(Array.from(event.currentTarget.files ?? []))}
        />
        <span>{fileLabel}</span>
      </label>
      <button
        type="button"
        className="plugins-view__primary"
        onClick={onImport}
        disabled={working || !canSubmit}
      >
        {working ? t('Importing…') : t('Import')}
      </button>
    </section>
  );
}
