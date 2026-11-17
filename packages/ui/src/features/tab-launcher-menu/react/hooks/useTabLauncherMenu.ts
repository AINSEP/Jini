import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type KeyboardEvent, type RefObject, type SetStateAction } from 'react';
import { useDismissOnOutsideOrEscape } from '../../../../browser/index.js';
import { ALL_KIND_FILTER } from '../../constants.js';
import {
  clampAnchoredPosition,
  clampSelection,
  filterFiles,
  filterTabs,
  nextSelected,
  presentKinds,
  resolveSelection,
} from '../../rules.js';
import type {
  TabLauncherAction,
  TabLauncherPosition,
  TabLauncherResultItem,
  TabLauncherTrackEvent,
} from '../../types.js';

export interface UseTabLauncherMenuOptions<TActionCtx = void> {
  /** The "+" button (or similar) the menu is anchored to, for fixed positioning. Menu stays closed (renders nothing) while null. */
  anchor: HTMLElement | null;
  files: readonly TabLauncherResultItem[];
  tabs?: readonly TabLauncherResultItem[];
  /** "Create new" actions shown above the search results. */
  actions?: readonly TabLauncherAction<TActionCtx>[];
  /** Context passed to every action's `run`. Only needed when `actions` is non-empty. */
  actionContext?: TActionCtx;
  onOpenFile: (item: TabLauncherResultItem) => void;
  onOpenTab?: (item: TabLauncherResultItem) => void;
  onTrack?: (event: TabLauncherTrackEvent) => void;
  onClose: () => void;
}

export interface TabLauncherMenuController<TActionCtx = void> {
  containerRef: RefObject<HTMLDivElement | null>;
  position: TabLauncherPosition | null;
  query: string;
  setQuery: (query: string) => void;
  kindFilter: string;
  setKindFilter: (kind: string) => void;
  presentKinds: string[];
  fileResults: TabLauncherResultItem[];
  tabResults: TabLauncherResultItem[];
  actions: readonly TabLauncherAction<TActionCtx>[];
  selected: number;
  setSelected: (index: number) => void;
  selectFile: (item: TabLauncherResultItem) => void;
  selectTab: (item: TabLauncherResultItem) => void;
  runAction: (action: TabLauncherAction<TActionCtx>) => void;
  handleInputKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
}

/** Viewport-clamped position off `anchor`, recalculated on scroll/resize. */
function useAnchoredPosition(anchor: UseTabLauncherMenuOptions['anchor']) {
  const [position, setPosition] = useState<TabLauncherPosition | null>(null);

  useLayoutEffect(() => {
    if (!anchor) return undefined;
    const update = () => {
      const rect = anchor.getBoundingClientRect();
      setPosition(clampAnchoredPosition(rect, window.innerWidth));
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [anchor]);

  return position;
}

interface ActivateSelectionParams<TActionCtx> {
  selected: number;
  fileResults: readonly TabLauncherResultItem[];
  tabResults: readonly TabLauncherResultItem[];
  actions: readonly TabLauncherAction<TActionCtx>[];
  selectFile: (item: TabLauncherResultItem) => void;
  selectTab: (item: TabLauncherResultItem) => void;
  runAction: (action: TabLauncherAction<TActionCtx>) => void;
}

/** Commit handlers: each reports to `onTrack`, performs the choice, then closes the menu. */
function useLauncherCommits<TActionCtx>(options: UseTabLauncherMenuOptions<TActionCtx>) {
  const { onOpenFile, onOpenTab, onTrack, onClose } = options;

  const selectFile = useCallback((item: TabLauncherResultItem) => {
    onTrack?.({ type: 'select-file', item });
    onOpenFile(item);
    onClose();
  }, [onTrack, onOpenFile, onClose]);

  const selectTab = useCallback((item: TabLauncherResultItem) => {
    onTrack?.({ type: 'select-tab', item });
    onOpenTab?.(item);
    onClose();
  }, [onTrack, onOpenTab, onClose]);

  const runAction = useCallback((action: TabLauncherAction<TActionCtx>) => {
    onTrack?.({ type: 'run-action', actionId: action.id });
    action.run(options.actionContext as TActionCtx);
    onClose();
  }, [onTrack, onClose, options.actionContext]);

  return { selectFile, selectTab, runAction };
}

interface LauncherResultsParams {
  files: UseTabLauncherMenuOptions['files'];
  tabs: NonNullable<UseTabLauncherMenuOptions['tabs']>;
  query: string;
  kindFilter: string;
  setSelected: Dispatch<SetStateAction<number>>;
}

/** Filtered file/tab results, plus keeping the selection inside their combined range. */
function useLauncherResults({ files, tabs, query, kindFilter, setSelected }: LauncherResultsParams) {
  const kinds = useMemo(() => presentKinds(files), [files]);
  const fileResults = useMemo(() => filterFiles(files, query, kindFilter), [files, query, kindFilter]);
  const tabResults = useMemo(() => filterTabs(tabs, query, kindFilter), [tabs, query, kindFilter]);
  const selectableCount = fileResults.length + tabResults.length;

  useEffect(() => {
    setSelected((current) => clampSelection(current, selectableCount));
  }, [selectableCount, setSelected]);

  return { kinds, fileResults, tabResults, selectableCount };
}

function useTrackOpenOnce(onTrack: UseTabLauncherMenuOptions['onTrack']) {
  const initialOnTrack = useRef(onTrack);
  useEffect(() => {
    initialOnTrack.current?.({ type: 'open' });
    // Fires once when the menu mounts (it only mounts while open) —
    // deliberately not re-fired on every onTrack identity change.
  }, []);
}

function arrowStep(key: string): 1 | -1 | 0 {
  if (key === 'ArrowDown') return 1;
  return key === 'ArrowUp' ? -1 : 0;
}

/** Enter: opens/runs whatever is currently selected. */
function activateSelection<TActionCtx>({
  selected,
  fileResults,
  tabResults,
  actions,
  selectFile,
  selectTab,
  runAction,
}: ActivateSelectionParams<TActionCtx>) {
  if (fileResults.length + tabResults.length === 0) {
    // No file/tab matches the query but "create new" actions exist —
    // Enter triggers the first one so the keyboard path is never a dead end.
    const firstAction = actions[0];
    if (firstAction) runAction(firstAction);
    return;
  }
  const resolved = resolveSelection(selected, fileResults.length);
  if (resolved.zone === 'file') {
    const file = fileResults[resolved.index];
    if (file) selectFile(file);
    return;
  }
  const tab = tabResults[resolved.index];
  if (tab) selectTab(tab);
}

/**
 * Owns anchored viewport-clamped positioning (recalculated on scroll/resize),
 * outside-click/Escape dismissal, file+tab search/kind-filter state, and
 * keyboard navigation (arrow-key selection spanning the "create new" actions,
 * file results, and tab results as one flat list; Enter opens/runs whatever
 * is selected) for a "+"-button launcher dropdown.
 */
export function useTabLauncherMenu<TActionCtx = void>(
  options: UseTabLauncherMenuOptions<TActionCtx>,
): TabLauncherMenuController<TActionCtx> {
  const { anchor, files, tabs = [], actions = [], onTrack, onClose } = options;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilterState] = useState<string>(ALL_KIND_FILTER);
  const [selected, setSelected] = useState(0);
  const position = useAnchoredPosition(anchor);

  useDismissOnOutsideOrEscape({ onDismiss: onClose }, { containerRef });

  const { kinds, fileResults, tabResults, selectableCount } = useLauncherResults({ files, tabs, query, kindFilter, setSelected });
  useTrackOpenOnce(onTrack);

  const setKindFilter = useCallback((kind: string) => {
    onTrack?.({ type: 'filter', kind });
    setKindFilterState(kind);
  }, [onTrack]);

  const { selectFile, selectTab, runAction } = useLauncherCommits(options);

  const handleInputKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    const step = arrowStep(event.key);
    if (step !== 0) {
      event.preventDefault();
      setSelected((current) => nextSelected(current, selectableCount, step));
      return;
    }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    activateSelection({ selected, fileResults, tabResults, actions, selectFile, selectTab, runAction });
  }, [selectableCount, selected, fileResults, tabResults, actions, selectFile, selectTab, runAction]);

  return {
    containerRef,
    position,
    query,
    setQuery,
    kindFilter,
    setKindFilter,
    presentKinds: kinds,
    fileResults,
    tabResults,
    actions,
    selected,
    setSelected,
    selectFile,
    selectTab,
    runAction,
    handleInputKeyDown,
  };
}
