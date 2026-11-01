import { useId, useState } from 'react';
import { useT } from '../hooks/context.js';
import { CopyMessageButton } from './CopyMessageButton.js';
import { Icon } from './Icon.js';

/** Display only: splitting both separators never changes the exact path carried or copied. */
function folderName({ path }: { path: string }, _options = {}): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

/** Shared composer/sent-message folder indicator; references never participate in uploads. */
export function FolderChips({ folders = [], onRemove }: {
  folders?: readonly string[] | undefined;
  onRemove?: (input: { path: string }, options?: {}) => void;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  if (folders.length === 0) return null;
  const label = folders.length === 1 ? folderName({ path: folders[0]! }) : t('Folders ({count})', { count: folders.length });
  return <div className="jini-folder-chips">
    <button type="button" className="jini-folder-chips__toggle" aria-expanded={expanded} aria-controls={id}
      title={folders.length === 1 ? folders[0] : undefined} aria-label={folders.length === 1 ? folders[0] : label}
      onClick={() => setExpanded(value => !value)}>
      <Icon name="folder" /><span>{label}</span><Icon name={expanded ? 'chevron-down' : 'chevron-right'} />
    </button>
    {expanded && <ul id={id} className="jini-folder-chips__list">{folders.map(path => <li key={path} className="jini-folder-chips__item">
      <Icon name="folder" />
      <span className="jini-folder-chips__name" title={path} aria-label={path}>{folderName({ path })}</span>
      <CopyMessageButton text={path} label={t('Copy folder path: {path}', { path })} />
      {onRemove && <button type="button" className="jini-folder-chips__remove" title={t('Remove folder: {path}', { path })}
        aria-label={t('Remove folder: {path}', { path })} onClick={() => onRemove({ path })}><Icon name="close" /></button>}
    </li>)}</ul>}
  </div>;
}
