import { useT } from '../../../i18n/index.js';

export interface AssetTreeFolderRowProps {
  /** The folder's basename at this level (not the full path). */
  name: string;
  /** Full path from the tree root — what `onNavigate` receives. */
  path: string;
  /** Total files under this folder at every depth (see `countFilesUnderDir`). */
  fileCount: number;
  onNavigate: (path: string) => void;
  useTHook?: typeof useT;
}

/** One subdirectory row: navigates into the folder on click (both the row itself and its name button — matches the origin `DesignFilesPanel`'s doubled click targets). */
export function AssetTreeFolderRow({ name, path, fileCount, onNavigate, useTHook = useT }: AssetTreeFolderRowProps) {
  const t = useTHook();

  return (
    <div
      data-testid={`asset-tree-dir-row-${path}`}
      className="jini-asset-tree-row jini-asset-tree-dir-row"
      onClick={() => onNavigate(path)}
    >
      <span className="jini-asset-tree-row-check" aria-hidden />
      <span className="jini-asset-tree-row-icon" data-kind="folder" aria-hidden>
        ▸
      </span>
      <div className="jini-asset-tree-row-name-wrap">
        <button type="button" className="jini-asset-tree-row-name-btn" onClick={() => onNavigate(path)}>
          <span className="jini-asset-tree-row-name-wrap">
            <span className="jini-asset-tree-row-name" title={name}>
              {name}
            </span>
            <span className="jini-asset-tree-row-sub">{t('{n} files', { n: fileCount })}</span>
          </span>
        </button>
      </div>
      <span className="jini-asset-tree-row-size" />
      <span className="jini-asset-tree-row-time" />
      <span className="jini-asset-tree-row-menu jini-asset-tree-row-menu-placeholder" aria-hidden />
    </div>
  );
}
