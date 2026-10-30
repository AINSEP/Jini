import type { ConfirmController } from '../types.js';
function visible(element: HTMLElement) {
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    const style = getComputedStyle(current);
    if (current.hidden || current.getAttribute('aria-hidden') === 'true' || style.display === 'none') return false;
    if (style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0') return false;
  }
  return true;
}
function inspectFrame({ controller: c, frame }: { controller: ConfirmController; frame: HTMLElement }, _optional: Record<string, never> = {}): string[] {
  const issues: string[] = [];
  if (frame.dataset.jiniPart !== 'confirm.dialog' || frame.getAttribute('role') !== 'alertdialog') issues.push('missing alertdialog semantics');
  if (!c.overlayContainer?.contains(frame)) issues.push('frame outside overlay container');
  if (frame.getAttribute('aria-labelledby') !== c.frameAttrs['aria-labelledby']) issues.push('missing title association');
  return issues;
}
function inspectForwardedAttrs({ name, element, attrs }: { name: string; element: HTMLElement; attrs: ConfirmController['cancel']['attrs'] }, _optional: Record<string, never> = {}): string[] {
  const issues: string[] = [];
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value !== undefined && element.getAttribute(key) !== String(value)) issues.push(`${name} did not forward ${key}`);
  }
  return issues;
}
function inspectAction({ name, element, bag, pending }: { name: string; element: HTMLElement | null; bag: ConfirmController['cancel']; pending: boolean }, _optional: Record<string, never> = {}): string[] {
  if (!element) return [`missing ${name} action`];
  const issues: string[] = [];
  if (!element.matches('button,input,[role="button"][tabindex]')) issues.push(`${name} part is not on a focusable action`);
  if (!visible(element)) issues.push(`${name} action hidden`);
  issues.push(...inspectForwardedAttrs({ name, element, attrs: bag.attrs }));
  if (pending && !element.matches(':disabled') && element.getAttribute('aria-disabled') !== 'true') issues.push(`${name} enabled while pending`);
  return issues;
}
function inspectInteraction({ controller: c, checkFocus, cancel, confirm, activeElement }: { controller: ConfirmController; checkFocus: boolean; cancel: HTMLElement | null; confirm: HTMLElement | null; activeElement: Element | null }, _optional: Record<string, never> = {}): string[] {
  const issues: string[] = [];
  if (!c.pending && checkFocus && cancel && activeElement !== cancel) issues.push('initial focus is not cancel');
  if (!c.agentMayConfirm && confirm && [confirm, ...confirm.querySelectorAll('*')].some(element =>
    element.getAttributeNames().some(name => name.startsWith('data-agent-')))) issues.push('human-only confirm published agent metadata');
  return issues;
}
function inspectDescription({ description, frame, confirm, consequence }: { description: HTMLElement | null; frame: HTMLElement; confirm: HTMLElement; consequence: string }, _optional: Record<string, never> = {}): string[] {
  const describedIds = confirm.getAttribute('aria-describedby')?.split(/\s+/) ?? [];
  if (!description || !frame.contains(description) || !visible(description)) return ['missing consequence label'];
  if (!describedIds.includes(description.id) || !description.textContent?.includes(consequence)) return ['missing consequence label'];
  return [];
}
function inspectConsequence({ controller: c, frame, confirm, document: dom }: { controller: ConfirmController; frame: HTMLElement; confirm: HTMLElement | null; document: Pick<Document, 'getElementById'> }, _optional: Record<string, never> = {}): string[] {
  if (!c.consequence || !confirm || confirm.getAttribute('aria-label')?.includes(c.consequence)) return [];
  // A concise action name still has to expose the real, visible consequence as its
  // description. An override dropping the associated paragraph must fail the guard.
  const description = c.consequenceAttrs?.id ? dom.getElementById(c.consequenceAttrs.id) : null;
  return inspectDescription({ description, frame, confirm, consequence: c.consequence });
}
/** Checks real mounted DOM. jsdom cannot prove layout or browser top-layer behavior; those are browser scenarios. */
export function inspectConfirm(required: { controller: ConfirmController; checkFocus: boolean }, _optional: Record<string, never> = {}): string[] {
  const c = required.controller;
  const frame = c.frameAttrs.id ? document.getElementById(c.frameAttrs.id) : null;
  if (!frame) return ['missing confirm frame'];
  const issues = inspectFrame({ controller: c, frame });
  const cancel = frame.querySelector<HTMLElement>('[data-jini-part="confirm.cancel"]');
  const confirm = frame.querySelector<HTMLElement>('[data-jini-part="confirm.confirm"]');
  issues.push(...inspectAction({ name: 'cancel', element: cancel, bag: c.cancel, pending: c.pending }));
  issues.push(...inspectAction({ name: 'confirm', element: confirm, bag: c.confirm, pending: c.pending }));
  issues.push(...inspectInteraction({ controller: c, checkFocus: required.checkFocus, cancel, confirm, activeElement: document.activeElement }));
  issues.push(...inspectConsequence({ controller: c, frame, confirm, document }));
  return issues;
}
