export type {
  TabStripDropEdge,
  TabStripDragTarget,
  TabStripTab,
  TabStripReorderTiming,
  TabStripElementRect,
} from './types.js';

export {
  TAB_STRIP_DRAG_HAPTIC_MS,
  TAB_STRIP_DROP_HAPTIC_MS,
  TAB_STRIP_ITEM_ID_ATTRIBUTE,
} from './constants.js';

export * from './rules.js';

export type { TabStripHapticsPort } from './ports.js';
export { noopTabStripHaptics } from './ports.js';
export { createBrowserTabStripHaptics } from './dependencies.js';

export { useTabStripDragReorder } from './react/hooks/useTabStripDragReorder.js';
export type {
  UseTabStripDragReorderOptions,
  UseTabStripDragReorderResult,
  TabStripItemDragProps,
} from './react/hooks/useTabStripDragReorder.js';

export { TabStripItem } from './react/components/TabStripItem.js';
export type { TabStripItemProps } from './react/components/TabStripItem.js';
export { TabStrip } from './react/components/TabStrip.js';
export type { TabStripProps } from './react/components/TabStrip.js';
export { TabBar } from './react/components/TabBar.js';
export type { TabBarProps, TabBarTab } from './react/components/TabBar.js';
export { useTabBarKeyboard, resolveTabBarKeyTarget, resolveTabBarTabIndex, tabHandleProps } from './react/components/TabBar.hooks.js';
export type { TabBarKeyboardHandlers } from './react/components/TabBar.hooks.js';
