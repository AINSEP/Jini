import { useId, useState } from 'react';
import { useT } from '../hooks/context.js';
import { CopyMessageButton } from './CopyMessageButton.js';
import { Icon } from './Icon.js';

/** Display only: splitting both separators never changes the exact path carried or copied. */
function folderName({ path }: { path: string }, _options = {}): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

type OnRemove = (input: { path: string }, options?: {}) => void;

/** One folder: last name (full path on hover), copy, and × when removable. */
function FolderChip({ path, onRemove }: { path: string; onRemove?: OnRemove | undefined }) {
  const t = useT();
  const copyLabel = t('Copy folder path: {path}', { path });
  const removeLabel = t('Remove folder: {path}', { path });
  return <li className="jini-folder-chips__item">
    <Icon name="folder" />
    <span className="jini-folder-chips__name" title={path} aria-label={path}>{folderName({ path })}</span>
    <CopyMessageButton text={path} label={copyLabel} title={copyLabel} />
    {onRemove && <button type="button" className="jini-folder-chips__remove" title={removeLabel}
      aria-label={removeLabel} onClick={() => onRemove({ path })}><Icon name="close" /></button>}
  </li>;
}

/**
 * Shared composer/sent-message folder indicator; references never participate in uploads.
 * One folder shows its chip directly; a "Folders (n)" toggle would only repeat its name.
 */
export function FolderChips({ folders = [], onRemove }: {
  folders?: readonly string[] | undefined;
  onRemove?: OnRemove | undefined;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  if (folders.length === 0) return null;
  const list = (listId?: string) => <ul id={listId} className="jini-folder-chips__list">
    {folders.map(path => <FolderChip key={path} path={path} onRemove={onRemove} />)}
  </ul>;
  if (folders.length === 1) return <div className="jini-folder-chips">{list()}</div>;
  return <div className="jini-folder-chips">
    <button type="button" className="jini-folder-chips__toggle" aria-expanded={expanded} aria-controls={id}
      onClick={() => setExpanded(value => !value)}>
      <Icon name="folder" /><span>{t('Folders ({count})', { count: folders.length })}</span><Icon name={expanded ? 'chevron-down' : 'chevron-right'} />
    </button>
    {expanded && list(id)}
  </div>;
}
