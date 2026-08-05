/**
 * All of `AgentRuntimePicker`'s behavior, so the component itself is only markup.
 *
 * What lives here is popover mechanics — open/close, dismissal, viewport-bounded positioning,
 * focus restoration, and roving/trapped keyboard focus — plus the two derived labels the view
 * shows. None of it is chat-specific; the only reason it is scoped to this feature rather than
 * promoted to `@jini-ai/ui` is noted at the bottom of this comment.
 *
 * The pure functions below are separated from the hook deliberately: geometry and key-to-index
 * resolution have real input/output contracts and edge cases (viewport clamping, `currentIndex`
 * of `-1`, Tab-at-an-edge) that are far cheaper to test directly than to drive through a rendered
 * popover with a mocked `getBoundingClientRect`. The hook itself owns only React lifecycle.
 *
 * **Not yet using `@jini-ai/ui`'s `useDismissOnOutsideOrEscape`**, which covers the same
 * outside-click/Escape ground and whose own doc notes six features had hand-rolled it before this
 * one. Two concrete mismatches block a drop-in: it takes a single `containerRef`, whereas here
 * "inside" means the trigger *or* the portaled popover (two disjoint subtrees, since the popover
 * renders into `document.body`); and it exposes one `onDismiss` with no indication of which input
 * dismissed, while this popover must restore focus on the next tick for a pointer and immediately
 * for Escape (see the comment on that timeout). Consolidating means extending the shared hook to
 * accept multiple containers and report the dismissal cause — worth doing, but as its own change
 * to a package other features already depend on, not as a side effect of this extraction.
 */
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react';

import { orderChatPaneAgents } from '../rules.js';
import type {
  ByokRuntimeSummary,
  ChatPaneAgent,
  ChatPaneAgentSelection,
  RuntimePickerPlacement,
} from '../types.js';

/** Everything in the popover a roving/trapping key handler is allowed to move focus between. */
const FOCUSABLE_CONTROLS = 'button:not(:disabled), select:not(:disabled), input:not(:disabled)';

/**
 * Resolves the user-facing label for a selected model or reasoning option.
 *
 * @complexity Time: O(n) in the supplied option count; space: O(1).
 * @overallScore 100/100
 */
export function runtimeOptionLabel(
  options: readonly { id: string; label: string }[] | undefined,
  value: string | undefined,
  fallback: string,
): string {
  if (!value || value === 'default') return fallback;
  return options?.find((option) => option.id === value)?.label ?? value;
}

/**
 * Computes a viewport-bounded fixed position for the body-portaled picker.
 *
 * @complexity Time/space: O(1).
 * @overallScore 100/100
 */
export function runtimePopoverPosition(
  trigger: DOMRect,
  placement: RuntimePickerPlacement,
): CSSProperties {
  const margin = 12;
  const gap = 8;
  const width = Math.min(320, window.innerWidth - margin * 2);
  const left = Math.min(
    Math.max(trigger.left + trigger.width / 2 - width / 2, margin),
    window.innerWidth - width - margin,
  );
  if (placement === 'up') {
    const availableHeight = Math.max(0, trigger.top - margin - gap);
    return {
      position: 'fixed',
      left,
      bottom: Math.max(margin, window.innerHeight - trigger.top + gap),
      width,
      maxHeight: Math.min(620, availableHeight),
      overflowY: 'auto',
      zIndex: 1000,
    };
  }
  const top = trigger.bottom + gap;
  const availableHeight = Math.max(0, window.innerHeight - top - margin);
  return {
    position: 'fixed',
    top,
    left,
    width,
    maxHeight: Math.min(620, availableHeight),
    overflowY: 'auto',
    zIndex: 1000,
  };
}

/** `Tab` wraps focus around the popover's control list instead of leaving it (the popover is a
 * modal-ish dialog). Returns the index to wrap TO, or `null` when `Tab` should behave natively
 * (not at an edge). `currentIndex` may be `-1` (active element not in `controls`); `atStart`/
 * `atEnd` below only matter when it legitimately is 0 or `count - 1`. */
export function resolveTabWrapIndex(shiftKey: boolean, currentIndex: number, count: number): number | null {
  if (shiftKey && currentIndex === 0) return count - 1;
  if (!shiftKey && currentIndex === count - 1) return 0;
  return null;
}

/** Arrow/Home/End roving-tabindex target, or `null` for any other key. `currentIndex === -1`
 * (nothing in `controls` focused yet) is a legitimate input — the modulo arithmetic below relies
 * on it wrapping the same way a real index would. */
export function resolveRovingIndex(key: string, currentIndex: number, count: number): number | null {
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === 'ArrowDown') return (currentIndex + 1 + count) % count;
  if (key === 'ArrowUp') return (currentIndex - 1 + count) % count;
  return null;
}

/**
 * The control index the popover's key handler should move focus to, or `null` to leave focus alone
 * (and, in the caller, to skip `preventDefault()`). `Tab` is resolved and returned immediately —
 * it must never fall through to the roving-tabindex logic below it.
 */
export function resolvePopoverKeyAction(
  key: string,
  shiftKey: boolean,
  isButtonTarget: boolean,
  currentIndex: number,
  count: number,
): number | null {
  if (key === 'Tab') return resolveTabWrapIndex(shiftKey, currentIndex, count);
  // Native selects own their arrow/Home/End behavior. Roving applies only
  // when a button (including the agent radios) has focus.
  if (!isButtonTarget) return null;
  return resolveRovingIndex(key, currentIndex, count);
}

/** Builds the one-line "which runtime am I talking to" summary shown in the popover head. */
export function runtimeSummaryText(
  selectedAgent: ChatPaneAgent | undefined,
  modelLabel: string,
  t: (key: string) => string,
): string {
  if (selectedAgent === undefined) return t('No agent selected');
  const version = selectedAgent.version ? ` · ${selectedAgent.version}` : '';
  return `${selectedAgent.name}${version} · ${modelLabel}`;
}

/**
 * The head/trigger labels while `executionMode` is `'api'`.
 *
 * Separate from {@link runtimeSummaryText} rather than folded into it because the two describe
 * different things and fail differently: that one names a detected CLI and its model, this one
 * names a provider and the model the credential is configured for, and neither has a sensible
 * fallback to the other. A missing provider label here is not "no agent selected" — the API path is
 * still what will run — so the fallback is a generic mode name, never a CLI's.
 *
 * @complexity Time/space: O(1).
 */
export function byokSummaryText(
  byokRuntime: ByokRuntimeSummary | undefined,
  t: (key: string) => string,
): { title: string; modelLabel: string; summary: string } {
  const title = byokRuntime?.providerLabel?.trim() || t('API · BYOK');
  const model = byokRuntime?.model?.trim();
  const modelLabel = model || t('No model configured');
  return { title, modelLabel, summary: `${title} · ${modelLabel}` };
}

export interface UseAgentRuntimePickerOptions {
  agents: readonly ChatPaneAgent[];
  value: ChatPaneAgentSelection;
  placement: RuntimePickerPlacement;
  /** Translator, injected rather than read from context so this hook is testable without a provider. */
  t: (key: string) => string;
  /** Which runtime the labels below should describe. Defaults to `'local'`, preserving the
   *  pre-BYOK behavior for every caller that does not pass one. */
  executionMode?: 'local' | 'api';
  /** Only read when `executionMode` is `'api'`. Explicitly `| undefined` because the package builds
   *  under `exactOptionalPropertyTypes` and the component forwards its own optional prop straight
   *  through. */
  byokRuntime?: ByokRuntimeSummary | undefined;
}

export interface UseAgentRuntimePickerResult {
  /** Ties the trigger's `aria-controls` to the popover's `id`. */
  dialogId: string;
  open: boolean;
  /** Undefined until the trigger has been measured; the popover does not render before then. */
  position: CSSProperties | undefined;
  triggerRef: RefObject<HTMLButtonElement | null>;
  popoverRef: RefObject<HTMLDivElement | null>;
  /** Unavailable agents removed, then ordered — what the radio group renders. */
  orderedAgents: readonly ChatPaneAgent[];
  selectedAgent: ChatPaneAgent | undefined;
  modelLabel: string;
  runtimeSummary: string;
  /** What the collapsed trigger names as the runtime — the selected CLI in `'local'`, the provider
   *  in `'api'`. A separate field because the trigger must NOT fall back to `selectedAgent.name`
   *  while an API turn is what would actually run. */
  triggerTitle: string;
  /**
   * The `data-theme` of the place the popover was opened FROM, or `null` when the host pins none.
   *
   * The popover renders through `createPortal` into `document.body`, so it escapes any `data-theme`
   * on an ancestor of the trigger — and `@jini-ai/ui` themes entirely through `[data-theme]` token
   * blocks, with its DARK values on a bare `@media (prefers-color-scheme: dark) { :root { … } }`.
   * The consequence is not hypothetical: measured in a host admin on a dark-mode machine, the
   * popover itself looked right (the chat package's own `--jini-chat-*` tokens default light) while
   * the `@jini-ai/ui` control inside it — the BYOK model select — resolved against that dark `:root`
   * block and rendered dark-on-dark inside an all-light admin.
   *
   * So the popover carries its origin's theme with it, the same compensation `CustomSelect` already
   * makes for its own portaled menu. `null` leaves document-level theming untouched, so a host that
   * pins nothing is byte-identical to before.
   */
  originTheme: string | null;
  toggleOpen: () => void;
  handlePopoverKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
}

/**
 * Owns the runtime picker's popover state so the component stays presentational.
 *
 * @complexity Time: O(n) in the agent count for ordering/selection; space: O(n) for the ordered
 * snapshot. The DOM queries are O(c) in the popover's own control count.
 */
export function useAgentRuntimePicker({
  agents,
  value,
  placement,
  t,
  executionMode = 'local',
  byokRuntime,
}: UseAgentRuntimePickerOptions): UseAgentRuntimePickerResult {
  const dialogId = useId();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const orderedAgents = useMemo(
    () => orderChatPaneAgents(agents.filter((agent) => agent.available !== false)),
    [agents],
  );
  const selectedAgent = orderedAgents.find((agent) => agent.id === value.agentId);

  // `selectedAgent` stays resolved in BOTH modes on purpose — the CLI selection is still the stored
  // one, and switching back to Local CLI must not have silently lost it. What changes in `'api'` is
  // only what gets DESCRIBED, because none of the CLI's labels are true of an API turn.
  const localModelLabel = runtimeOptionLabel(selectedAgent?.models, value.model, t('Default model'));
  const byok = byokSummaryText(byokRuntime, t);
  const isApi = executionMode === 'api';
  const modelLabel = isApi ? byok.modelLabel : localModelLabel;
  const runtimeSummary = isApi ? byok.summary : runtimeSummaryText(selectedAgent, localModelLabel, t);
  const triggerTitle = isApi ? byok.title : (selectedAgent?.name ?? t('Choose agent'));

  // Read during render rather than in an effect: the popover only mounts once `open` is true, which
  // is itself a re-render, and `triggerRef` is populated at the first commit — so by the time this
  // value is used it is always resolved. See `originTheme` on the result type for why it exists.
  const originTheme = triggerRef.current?.closest('[data-theme]')?.getAttribute('data-theme') ?? null;

  const focusTrigger = useCallback(() => {
    triggerRef.current?.focus();
  }, []);

  const toggleOpen = useCallback(() => {
    setOpen((current) => !current);
  }, []);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        triggerRef.current?.contains(target)
        || popoverRef.current?.contains(target)
        // A control INSIDE the popover may itself portal its menu to `document.body` —
        // `@jini-ai/ui`'s `CustomSelect` (and so `SearchableModelSelect`, which the BYOK model row
        // uses) does exactly that. Such a menu is a descendant of neither ref, so without this the
        // first mousedown on a model option would be read as an outside click and close the
        // popover out from under the selection the operator was making.
        || (target instanceof Element && target.closest('.jini-select-menu') !== null)
      ) return;
      setOpen(false);
      // Let the pointer's click complete before restoring focus. Otherwise the
      // browser focuses the clicked node after this mousedown handler runs.
      window.setTimeout(focusTrigger, 0);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      focusTrigger();
    };
    document.addEventListener('mousedown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [focusTrigger, open]);

  useEffect(() => {
    if (!open) return;
    const update = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) setPosition(runtimePopoverPosition(rect, placement));
    };
    update();
    window.addEventListener('resize', update);
    // Capture phase: a scroll inside any ancestor moves the trigger too, and scroll does not bubble.
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, placement]);

  useEffect(() => {
    if (!open || !position) return;
    const popover = popoverRef.current;
    const selectedRadio = popover?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]');
    const fallback = popover?.querySelector<HTMLElement>(FOCUSABLE_CONTROLS);
    (selectedRadio ?? fallback)?.focus();
  }, [open, position]);

  const handlePopoverKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    // No `?? []` fallback for a null ref: this handler is only ever reachable via the
    // `onKeyDown` React wires to the exact element `popoverRef` is attached to, and
    // React attaches refs during commit — before that element can dispatch any event — so
    // `popoverRef.current` is guaranteed non-null by the time this runs.
    const controls = [...popoverRef.current!.querySelectorAll<HTMLElement>(FOCUSABLE_CONTROLS)];
    if (controls.length === 0) return;

    const currentIndex = controls.indexOf(document.activeElement as HTMLElement);
    const nextIndex = resolvePopoverKeyAction(
      event.key,
      event.shiftKey,
      event.target instanceof HTMLButtonElement,
      currentIndex,
      controls.length,
    );
    if (nextIndex === null) return;
    event.preventDefault();
    controls[nextIndex]?.focus();
  }, []);

  return {
    dialogId,
    open,
    position,
    triggerRef,
    popoverRef,
    orderedAgents,
    selectedAgent,
    modelLabel,
    runtimeSummary,
    triggerTitle,
    originTheme,
    toggleOpen,
    handlePopoverKeyDown,
  };
}
