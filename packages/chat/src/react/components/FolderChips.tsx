import { agentHandleProps, agentHandleSegment } from '@jini-ai/core/agent-handles';
import { useT } from '../hooks/context.js';
import { CopyMessageButton } from './CopyMessageButton.js';
import { Icon } from './Icon.js';
import { useFolderChips } from './FolderChips.hooks.js';

/** Display only: splitting both separators never changes the exact path carried or copied. */
function folderName({ path }: { path: string }, _options = {}): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

type OnRemove = (input: { path: string }, options?: {}) => void;

/** One folder: last name (full path on hover), copy, and × when removable. */
function FolderChip({ base, path, onRemove, useTHook = useT }: { base: string | undefined; path: string; onRemove?: OnRemove | undefined } & { useTHook?: typeof useT }) {
  const t = useTHook();
  const segment = agentHandleSegment({ value: path });
  const copyLabel = t('Copy folder path: {path}', { path });
  const removeLabel = t('Remove folder: {path}', { path });
  return <li className="jini-folder-chips__item">
    <Icon name="folder" />
    <span className="jini-folder-chips__name" title={path} aria-label={path}>{folderName({ path })}</span>
    <CopyMessageButton agentHandle={base ? `${base}-folder-copy-${segment}` : false} text={path} label={copyLabel} title={copyLabel} />
    {onRemove && <button type="button" className="jini-folder-chips__remove" title={removeLabel}
      {...agentHandleProps({}, { base, action: `folder-remove-${segment}`, role: 'button', label: removeLabel })}
      aria-label={removeLabel} onClick={() => onRemove({ path })}><Icon name="close" /></button>}
  </li>;
}

/** Hooks FolderChips calls; defaults to the real ones, a test hands in fakes. */
export const defaultFolderChipsHooks = { useT, useFolderChips };
export type FolderChipsHooks = typeof defaultFolderChipsHooks;

/**
 * Shared composer/sent-message folder indicator; references never participate in uploads.
 * One folder shows its chip directly; a "Folders (n)" toggle would only repeat its name.
 */
export function FolderChips({ agentHandle, folders = [], onRemove, hooks = defaultFolderChipsHooks }: {
  /** Inherited Composer base; standalone sent-message folders remain opt-in. */
  agentHandle?: string | false | undefined;
  folders?: readonly string[] | undefined;
  onRemove?: OnRemove | undefined;
} & { hooks?: FolderChipsHooks | undefined }) {
  const base = agentHandle || undefined;
  const t = hooks.useT();
  const { expanded, setExpanded, id, list } = hooks.useFolderChips({ folders, renderChip: path => <FolderChip key={path} base={base} path={path} onRemove={onRemove} /> });
  if (folders.length === 0) return null;
  if (folders.length === 1) return <div className="jini-folder-chips">{list()}</div>;
  return <div className="jini-folder-chips">
    <button type="button" className="jini-folder-chips__toggle" aria-expanded={expanded} aria-controls={id}
      {...agentHandleProps({}, { base, action: 'folders-toggle', role: 'button', label: t('Folders ({count})', { count: folders.length }) })}
      onClick={() => setExpanded(value => !value)}>
      <Icon name="folder" /><span>{t('Folders ({count})', { count: folders.length })}</span><Icon name={expanded ? 'chevron-down' : 'chevron-right'} />
    </button>
    {expanded && list(id)}
  </div>;
}
