import { useId, useState, type ReactNode } from 'react';

/** Track disclosure state and render the same list for single and multiple folders. */
export function useFolderChips({ folders, renderChip }: { folders: readonly string[]; renderChip: (path: string) => ReactNode }, _options = {}) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const list = (listId?: string) => <ul id={listId} className="jini-folder-chips__list">
    {folders.map(renderChip)}
  </ul>;
  return { expanded, setExpanded, id, list };
}
