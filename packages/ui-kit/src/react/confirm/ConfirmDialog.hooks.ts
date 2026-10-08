import { createElement, useEffect, useId, useInsertionEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KitAttrs, AgentSpec, AgentAttrsPort } from '../../attrs.js';
import { createConfirmController, planConfirm } from '../../confirm.js';
import { useKit, useOverlayContainer } from '../Kit.hooks.js';
import { isDevelopment } from '../context.js';
import { nativeKit } from '../native/index.js';
import { inspectConfirm } from './guard.js';
import type { ConfirmController, ConfirmDialogProps } from '../types.js';
/** Shared confirmation policy and execution; adapters may supply their existing agent-attribute port.
 * @example useConfirmController({ open, title, confirmLabel, onConfirm, onCancel }, { agent: agentAttrs })
 */
export function useConfirmController(required: ConfirmDialogProps, optional: { agent?: AgentAttrsPort } = {}): ConfirmController {
  const context = useKit({}), titleId = useId(), frameId = useId(), consequenceId = useId(), cancelRef = useRef<HTMLButtonElement>(null);
  const boundaryRef = useRef<HTMLSpanElement>(null), latest = useRef(required), mounted = useRef(false);
  const [executing, setExecuting] = useState(false), [error, setError] = useState(false);
  latest.current = required;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const model = useMemo(() => createConfirmController({ read: () => latest.current,
    onCancel: () => latest.current.onCancel({}), onConfirm: () => latest.current.onConfirm({}) }), []);
  const pending = !!required.pending || executing;
  const plan = planConfirm({ ...required, cancelLabel: required.cancelLabel ?? context.cancelLabel, pending });
  function actionAttrs(part: string, spec: AgentSpec | undefined, label: string): KitAttrs {
    const agent = optional.agent ?? context.agent;
    const attrs = spec && agent ? agent({ handle: spec.handle }, { role: spec.role, label: spec.label }) : {};
    return Object.freeze({ ...attrs, 'data-jini-part': part, 'aria-label': label,
      ...(required.actionAccessibleNames && plan.consequence ? { 'aria-describedby': consequenceId } : {}),
      'aria-busy': pending, 'data-jini-state': pending ? 'pending' : 'ready' });
  }
  async function onPress() {
    if (model.isExecuting({}) || !latest.current.open || latest.current.pending) return;
    setExecuting(true); setError(false);
    try { await model.confirm({ actor: 'human' }); }
    catch { if (mounted.current) setError(true); }
    finally { if (mounted.current) setExecuting(false); }
  }
  return { className: required.className, open: required.open, pending, title: required.title, body: required.body, consequence: plan.consequence,
    error: error ? createElement('p', { className: 'jini-notice jini-notice-error', role: 'alert' }, required.errorLabel ?? 'The action failed. Please try again.') : null,
    frameAttrs: Object.freeze({ ...required.attrs, id: frameId, 'data-jini-part': 'confirm.dialog', role: 'alertdialog' as const,
      'aria-labelledby': titleId, 'aria-modal': true, 'aria-busy': pending }),
    titleAttrs: { id: titleId, 'data-jini-part': 'confirm.title' } as ConfirmController['titleAttrs'],
    consequenceAttrs: { id: consequenceId, 'data-jini-part': 'confirm.consequence' } as NonNullable<ConfirmController['consequenceAttrs']>,
    cancel: Object.freeze({ attrs: actionAttrs('confirm.cancel', plan.cancel, required.actionAccessibleNames?.cancel ?? plan.cancel?.label ?? `${plan.cancelLabel} — no action taken`),
      ref: cancelRef, disabled: pending, variant: 'secondary' as const, children: plan.cancelLabel,
      onPress: () => { model.requestDismiss({ reason: 'cancel-button' }); } }),
    confirm: Object.freeze({ attrs: actionAttrs('confirm.confirm', plan.confirm, required.actionAccessibleNames?.confirm ?? plan.confirmLabel), disabled: pending, pending,
      variant: plan.confirmVariant, children: required.confirmLabel, onPress }),
    boundaryRef, overlayContainer: useOverlayContainer({}), agentMayConfirm: required.agentMayConfirm !== false,
    requestDismiss: model.requestDismiss,
    focusInitial(_required: Record<string, never>, _optional: Record<string, never> = {}) { cancelRef.current?.focus(); },
  };
}
export function useConfirmFacade(required: ConfirmDialogProps, _optional: Record<string, never> = {}) {
  const c = useConfirmController(required), context = useKit({}), [, refresh] = useState(0);
  const initial = useRef(true), opener = useRef<Element | null>(null);
  const failed = context.guard !== 'off' && context.kit.failed.has('ConfirmDialog');
  const Component = failed ? nativeKit.ConfirmDialog : context.kit.components.ConfirmDialog;
  // Insertion effects precede every child's layout effects (including showModal's focus move).
  // Capturing in a parent layout effect instead captures Cancel and restores focus into a closed dialog.
  useInsertionEffect(() => { if (c.open) opener.current = document.activeElement; }, [c.open]);
  useLayoutEffect(() => {
    if (!c.open) {
      initial.current = true;
      // React restores selection between cleanup and layout setup; restore the trigger after that step.
      if (opener.current instanceof HTMLElement && opener.current.isConnected) opener.current.focus();
      return;
    }
    c.focusInitial({});
    return () => { if (opener.current instanceof HTMLElement && opener.current.isConnected) opener.current.focus(); };
  }, [c.open, Component]);
  useEffect(() => {
    if (!c.open || failed || context.guard === 'off' || !isDevelopment({})) return;
    if (!context.kit.overrides.includes('ConfirmDialog') && !context.kit.overrides.includes('Button')) return;
    // After the committed view's effects, including library portal/focus synchronization.
    const timer = setTimeout(() => {
      const reasons = inspectConfirm({ controller: c, checkFocus: initial.current });
      initial.current = false;
      if (!reasons.length) return;
      if (!context.kit.violations.some(v => v.component === 'ConfirmDialog' && v.reasons.join() === reasons.join())) {
        context.kit.violations.push({ component: 'ConfirmDialog', reasons });
        console.error(`@jini-ai/ui-kit ConfirmDialog conformance violation: ${reasons.join('; ')}`);
      }
      if (context.guard === 'fallback') { context.kit.failed.add('ConfirmDialog'); refresh(value => value + 1); }
    }, 0);
    return () => clearTimeout(timer);
  }, [c.open, c.pending, c.agentMayConfirm, c.consequence, Component, context, failed]);
  return { Component, controller: failed ? { ...c, nativeActions: true } : c };
}
