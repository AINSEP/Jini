import { MediaCard } from './MediaCard.js';
import { useMediaGrid } from '../hooks/MediaGrid.hooks.js';
import type { MediaGridProps } from '../hooks/MediaGrid.hooks.js';
export type { MediaGridProps } from '../hooks/MediaGrid.hooks.js';
export function MediaGrid(props: MediaGridProps, _optional: Record<string, never> = {}) {
  const vm = useMediaGrid(props);
  return (
    <div className={vm.className} data-jini-part="media.grid" ref={vm.gridRef} tabIndex={-1} aria-label="Media library">
      {vm.actions.length ? (
        vm.actions.map((action) => (
          <MediaCard
            key={action.item.id}
            {...action}
            api={vm.api}
            {...(vm.busy === undefined ? {} : { busy: vm.busy })}
          />
        ))
      ) : (
        <div className="jini-card"><div className="jini-empty-state"><p className="jini-empty-state-title">{vm.emptyLabel ?? 'No media found'}</p></div></div>
      )}
    </div>
  );
}
