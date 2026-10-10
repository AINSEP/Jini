import { useState } from 'react';
import { partitionAgentsByInstalled } from '../../rules.js';
import type { DetectedAgent } from '../../types.js';

export interface UseLocalCliAgentListResult {
  /** Installed CLIs plus the current pick: always rendered. */
  visible: DetectedAgent[];
  /** Not-installed CLIs: rendered only while `showCollapsed`. */
  collapsed: DetectedAgent[];
  showCollapsed: boolean;
  toggleCollapsed: () => void;
}

/**
 * Disclosure state for the CLI grid's not-installed tail. Collapsed by default: those cards
 * cannot be picked until installed, and a dozen of them pushed every setting below the grid
 * off-screen. See `partitionAgentsByInstalled` for what stays visible.
 */
export function useLocalCliAgentList(
  { agents, selectedAgentId }: { agents: readonly DetectedAgent[]; selectedAgentId: string | null },
): UseLocalCliAgentListResult {
  const [showCollapsed, setShowCollapsed] = useState(false);
  const { visible, collapsed } = partitionAgentsByInstalled(agents, selectedAgentId);
  return { visible, collapsed, showCollapsed, toggleCollapsed: () => setShowCollapsed((open) => !open) };
}
