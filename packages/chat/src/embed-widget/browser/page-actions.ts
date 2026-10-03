/** Resolved target supplied by the host; the client never derives a path from a title. */
export interface ResolvedPageTarget { readonly slug: string; readonly title: string; readonly path: string }
export type PageAction =
  | { readonly type: 'navigate'; readonly target: ResolvedPageTarget; readonly auto: boolean }
  | { readonly type: 'scroll_to' | 'highlight'; readonly target: ResolvedPageTarget };
export type NavigateAction = Extract<PageAction, { type: 'navigate' }>;
export type NonNavigateAction = Exclude<PageAction, { type: 'navigate' }>;
export interface DirectiveCarryingEvent { readonly kind: string; readonly name?: string; readonly data?: unknown }
export interface SplitPageActions { readonly navigate: NavigateAction | null; readonly other: NonNavigateAction | null }
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function target(value: unknown): value is ResolvedPageTarget {
  return record(value) && typeof value.slug === 'string' && typeof value.title === 'string' && typeof value.path === 'string';
}
/** Narrows an untrusted, bare queued action. URL authorization remains a separate host policy. O(1). */
export function isQueuedPageAction(args: { value: unknown }): args is { value: PageAction } {
  const { value } = args;
  if (!record(value) || !target(value.target)) return false;
  return value.type === 'navigate' ? typeof value.auto === 'boolean' : value.type === 'scroll_to' || value.type === 'highlight';
}
/** Narrows an untrusted directive envelope, dropping unknown kinds. O(1). */
export function isPageActionDirective(args: { value: unknown }): args is { value: { kind: 'page_action'; action: PageAction } } {
  const { value } = args;
  return record(value) && value.kind === 'page_action' && isQueuedPageAction({ value: value.action });
}
/** Preserves valid action order while ignoring unrelated events. O(events) time and output space. */
export function extractPageActions({ events, directiveEventName }: {
  events: readonly DirectiveCarryingEvent[] | undefined; directiveEventName: string;
}): PageAction[] {
  const actions: PageAction[] = [];
  for (const event of events ?? []) {
    const envelope = { value: event.data };
    if (event.kind === 'ext' && event.name === directiveEventName && isPageActionDirective(envelope)) {
      actions.push(envelope.value.action);
    }
  }
  return actions;
}
/** Returns only the first navigation and first page treatment. O(actions), O(1) extra space. */
export function splitPageActions({ actions }: { actions: readonly PageAction[] }): SplitPageActions {
  return {
    navigate: actions.find((a): a is NavigateAction => a.type === 'navigate') ?? null,
    other: actions.find((a): a is NonNavigateAction => a.type !== 'navigate') ?? null,
  };
}
export interface TargetSelectionPolicy { readonly candidateSelector: string; readonly excludedAncestorSelector: string }
/** Exact title match first, case-insensitive fallback; never searches excluded UI. O(candidates). */
export function findTargetElement({ title, root, selection }: {
  title: string; root: Pick<ParentNode, 'querySelectorAll'>; selection: TargetSelectionPolicy;
}): Element | null {
  const needle = title.trim();
  if (!needle) return null;
  const candidates = Array.from(root.querySelectorAll(selection.candidateSelector))
    .filter(el => !el.closest(selection.excludedAncestorSelector));
  return candidates.find(el => (el.textContent ?? '').trim() === needle)
    ?? candidates.find(el => (el.textContent ?? '').trim().toLowerCase() === needle.toLowerCase()) ?? null;
}
export interface PageActionTimerPort {
  schedule(args: { callback: () => void; delayMs: number }): unknown;
  cancel(args: { handle: unknown }): void;
}
export interface PageActionPort {
  allows(args: { action: PageAction }): boolean;
  navigate(args: { action: NavigateAction }): boolean;
  execute(args: { action: NonNavigateAction }): boolean;
  clearHighlight(args: Record<string, never>): void;
}
export interface BrowserPageActionController extends PageActionPort {
  applyHighlight(args: { element: Element }): void;
  scrollToElement(args: { element: Element }): void;
}
export interface BrowserPageActionsArgs {
  readonly root: Pick<ParentNode, 'querySelectorAll'>;
  readonly selection: TargetSelectionPolicy;
  readonly allowPath: (args: { path: string }) => boolean;
  readonly navigate: (args: { path: string }) => void;
  readonly reducedMotion: (args: Record<string, never>) => boolean;
  readonly scroll: (args: { element: Element; options: ScrollIntoViewOptions }) => void;
  readonly timers: PageActionTimerPort;
  readonly highlightClass: string;
  readonly fadeAnimationName: string;
  readonly cleanupFallbackMs: number;
}
/**
 * Creates page effects with injected DOM, navigation, URL policy, scroll and timers.
 * At most one highlight belongs to this instance; cleanup and navigation remove it.
 * URL policy is checked before queueing, navigation or page effects. Stale timers and descendant
 * animation events cannot remove the current highlight. Navigation paths are resolved by the host,
 * never guessed from a title; each controller owns its mutable highlight state.
 * @complexity Execute O(candidates); other operations O(1), with one timer/listener retained.
 */
export function createBrowserPageActions(args: BrowserPageActionsArgs): BrowserPageActionController {
  if (!Number.isFinite(args.cleanupFallbackMs) || args.cleanupFallbackMs < 0) throw new Error('Invalid highlight deadline');
  let current: { element: Element; handle: unknown; onEnd: EventListener } | null = null;
  const clearHighlight = (_args: Record<string, never>): void => {
    if (!current) return;
    const old = current;
    current = null;
    args.timers.cancel({ handle: old.handle });
    old.element.removeEventListener('animationend', old.onEnd);
    old.element.classList.remove(args.highlightClass);
  };
  function highlight(element: Element): void {
    if (current?.element === element) return;
    clearHighlight({});
    const onEnd: EventListener = event => {
      if (event.target === element && (event as AnimationEvent).animationName === args.fadeAnimationName) clearHighlight({});
    };
    element.classList.add(args.highlightClass);
    element.addEventListener('animationend', onEnd);
    // Identity check makes even a late callback from a canceled timer harmless.
    const handle = args.timers.schedule({ delayMs: args.cleanupFallbackMs, callback: () => {
      if (current?.element === element && current.onEnd === onEnd) clearHighlight({});
    } });
    current = { element, handle, onEnd };
  }
  const scrollToElement = ({ element }: { element: Element }): void => {
    args.scroll({ element, options: { behavior: args.reducedMotion({}) ? 'auto' : 'smooth', block: 'center' } });
  };
  return {
    applyHighlight({ element }) { highlight(element); },
    scrollToElement,
    allows({ action }) { return args.allowPath({ path: action.target.path }); },
    navigate({ action }) {
      if (!args.allowPath({ path: action.target.path })) return false;
      clearHighlight({});
      args.navigate({ path: action.target.path });
      return true;
    },
    execute({ action }) {
      if (!args.allowPath({ path: action.target.path })) return false;
      const element = findTargetElement({ title: action.target.title, root: args.root, selection: args.selection });
      if (!element) return false;
      scrollToElement({ element });
      if (action.type === 'highlight') highlight(element);
      return true;
    },
    clearHighlight,
  };
}
