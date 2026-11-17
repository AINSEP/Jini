import { useT } from '../../../i18n/index.js';
import type { AssetTreeToolbarAction } from '../../types.js';

export interface AssetTreeToolbarProps {
  actions: readonly AssetTreeToolbarAction[];
  useTHook?: typeof useT;
}

/**
 * Renders the host's `toolbarActions` (upload/new-file/etc. — this package
 * ships no built-in actions of its own; every button here is host-supplied,
 * see `AssetTreeBrowser`'s doc comment for what the origin `DesignFilesPanel`
 * shipped inline instead). `action.icon` is threaded through as a raw
 * `data-icon` attribute rather than resolved to a rendered glyph — this
 * package has no opinion on the host's icon system.
 */
export function AssetTreeToolbar({ actions, useTHook = useT }: AssetTreeToolbarProps) {
  const t = useTHook();
  if (actions.length === 0) return null;

  return (
    <div className="asset-tree-toolbar-actions">
      {actions.map((action) => (
        <button
          key={action.key}
          type="button"
          data-testid={action.testId}
          data-icon={action.icon}
          disabled={action.disabled}
          title={t(action.label)}
          onClick={action.onSelect}
        >
          {t(action.label)}
        </button>
      ))}
    </div>
  );
}
