import { useT } from '../../../i18n/index.js';
import { buildBreadcrumbSegments } from '../../rules.js';

export interface AssetTreeBreadcrumbsProps {
  currentDir: string;
  /** The root segment's label (host-owned — e.g. a project/working-dir name, or a generic "Files" fallback). */
  rootLabel: string;
  onNavigate: (dir: string) => void;
  useTHook?: typeof useT;
}

/** Directory breadcrumb trail: the root label plus one clickable segment per path component, the last always non-interactive (the current directory). */
export function AssetTreeBreadcrumbs({ currentDir, rootLabel, onNavigate, useTHook = useT }: AssetTreeBreadcrumbsProps) {
  const t = useTHook();
  const segments = buildBreadcrumbSegments({ currentDir });
  const atRoot = currentDir === '';

  return (
    <nav className="jini-asset-tree-breadcrumbs" aria-label={t('Breadcrumbs')}>
      {atRoot ? (
        <span className="jini-asset-tree-breadcrumb-current">{rootLabel}</span>
      ) : (
        <button type="button" className="jini-asset-tree-breadcrumb-btn" onClick={() => onNavigate('')}>
          {rootLabel}
        </button>
      )}
      {segments.map((segment) => (
        <span key={segment.path} className="jini-asset-tree-breadcrumb-segment">
          <span className="jini-asset-tree-breadcrumb-sep" aria-hidden>
            /
          </span>
          {segment.isLast ? (
            <span className="jini-asset-tree-breadcrumb-current">{segment.label}</span>
          ) : (
            <button type="button" className="jini-asset-tree-breadcrumb-btn" onClick={() => onNavigate(segment.path)}>
              {segment.label}
            </button>
          )}
        </span>
      ))}
    </nav>
  );
}
