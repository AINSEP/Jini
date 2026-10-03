import { useEffect, useMemo } from 'react';
import type { RefObject } from 'react';
import { useGlobalKeydown } from '../../../../browser/useGlobalKeydown.js';
import {
  DEFAULT_CONTEXT_MENU_ACTION_ORDER,
  DEFAULT_CONTEXT_MENU_RECOGNIZED_ACTIONS,
  DEFAULT_MERMAID_INSERT_LABEL_PATTERN,
  DEFAULT_SKETCH_TOOLTIP_TARGETS,
} from '../../constants.js';
import {
  applySketchContextMenuSimplification,
  applySketchDomTextOverrides,
  applySketchEditorTooltips,
  enhanceSketchExcalidrawPortals,
  handleSketchPortalCommandEnter,
  rewriteExcalidrawUnableToEmbedToasts,
} from '../../dom.js';
import { buildSketchTooltipLabels } from '../../rules.js';
import type { SketchDomTextOverrides, SketchTooltipTarget, SketchTranslate } from '../../types.js';

export interface UseSketchDomEnhancementsParams {
  containerRef: RefObject<HTMLElement | null>;
  t: SketchTranslate;
  /** Host-supplied translations for Excalidraw's own baked-in English UI
   *  text — no default translated copy ships (see `packages/ui/archived provenance ledger`). */
  domTextOverrides?: SketchDomTextOverrides | undefined;
  tooltipTargets?: readonly SketchTooltipTarget[] | undefined;
  contextMenuActionOrder?: readonly string[] | undefined;
  contextMenuRecognizedActions?: readonly string[] | undefined;
  /** Locale-specific phrasings of Excalidraw's "can't embed this URL" toast
   *  a host has already translated via `domTextOverrides`, so the toast
   *  rewrite still recognizes it. */
  embedUnavailableAdditionalPhrases?: readonly string[] | undefined;
  mermaidInsertLabelPattern?: RegExp | undefined;
  onCloseActiveDialog: () => void;
}

/**
 * The MutationObserver-driven DOM-enhancement toolkit, wired up as one
 * effect: tooltip injection, context-menu simplification, DOM text
 * overrides, toast rewriting, and modal/portal enhancement, all re-applied
 * on every DOM mutation Excalidraw itself makes (it exposes no hooks for
 * any of this).
 */
export function useSketchDomEnhancements({
  containerRef,
  t,
  domTextOverrides,
  tooltipTargets = DEFAULT_SKETCH_TOOLTIP_TARGETS,
  contextMenuActionOrder = DEFAULT_CONTEXT_MENU_ACTION_ORDER,
  contextMenuRecognizedActions = DEFAULT_CONTEXT_MENU_RECOGNIZED_ACTIONS,
  embedUnavailableAdditionalPhrases = [],
  mermaidInsertLabelPattern = DEFAULT_MERMAID_INSERT_LABEL_PATTERN,
  onCloseActiveDialog,
}: UseSketchDomEnhancementsParams): void {
  const tooltipLabels = useMemo(() => buildSketchTooltipLabels(t), [t]);
  const closeLabel = t('Close');

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    let frame: number | null = null;
    const applyEnhancements = () => {
      frame = null;
      applySketchEditorTooltips(root, tooltipLabels, tooltipTargets);
      applySketchDomTextOverrides(root, domTextOverrides);
      applySketchContextMenuSimplification(root, root, contextMenuActionOrder, contextMenuRecognizedActions);
      applySketchContextMenuSimplification(document.body, root, contextMenuActionOrder, contextMenuRecognizedActions);
      rewriteExcalidrawUnableToEmbedToasts(root, tooltipLabels.embeddable, embedUnavailableAdditionalPhrases);
      rewriteExcalidrawUnableToEmbedToasts(document.body, tooltipLabels.embeddable, embedUnavailableAdditionalPhrases);
      enhanceSketchExcalidrawPortals(closeLabel, onCloseActiveDialog, domTextOverrides, mermaidInsertLabelPattern);
    };
    const scheduleEnhancements = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(applyEnhancements);
    };
    scheduleEnhancements();

    const observer = new MutationObserver(scheduleEnhancements);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [
    closeLabel,
    containerRef,
    contextMenuActionOrder,
    contextMenuRecognizedActions,
    domTextOverrides,
    embedUnavailableAdditionalPhrases,
    mermaidInsertLabelPattern,
    onCloseActiveDialog,
    tooltipLabels,
    tooltipTargets,
  ]);

  // Both listeners run in the capture phase on `document` (not scoped to
  // `containerRef`) to win a race against Excalidraw's own bundled
  // listeners — see `useGlobalKeydown`'s doc comment in
  // `packages/ui/src/browser/useGlobalKeydown.ts`, which extracted this
  // exact shape out of this hook. `useGlobalKeydown` re-reads its handler
  // via a latest-ref internally, so passing a fresh closure each render is
  // fine — no memoization needed here.
  useGlobalKeydown({
    handler: (event) => {
      if (event.key !== 'Escape') return;
      if (!document.querySelector('.jini-sketch-modal .Modal')) return;
      event.preventDefault();
      event.stopPropagation();
      onCloseActiveDialog();
    },
  }, { target: 'document', capture: true });

  useGlobalKeydown({ handler: (event) => handleSketchPortalCommandEnter(event, mermaidInsertLabelPattern) }, {
    target: 'document',
    capture: true,
  });
}
