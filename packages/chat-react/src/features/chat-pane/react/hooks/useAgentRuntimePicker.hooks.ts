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

import { orderChatPaneAgents } from '../../rules.js';
import type {
  ChatPaneAgent,
  ChatPaneAgentSelection,
  RuntimePickerPlacement,
} from '../../types.js';

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

export interface UseAgentRuntimePickerOptions {
  agents: readonly ChatPaneAgent[];
  value: ChatPaneAgentSelection;
  placement: RuntimePickerPlacement;
  /** Translator, injected rather than read from context so this hook is testable without a provider. */
  t: (key: string) => string;
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
  const modelLabel = runtimeOptionLabel(selectedAgent?.models, value.model, t('Default model'));
  const runtimeSummary = runtimeSummaryText(selectedAgent, modelLabel, t);

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
    toggleOpen,
    handlePopoverKeyDown,
  };
}
