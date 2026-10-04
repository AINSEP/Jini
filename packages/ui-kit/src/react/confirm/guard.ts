import type { ConfirmController } from '../types.js';
function visible(element: HTMLElement) {
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    const style = getComputedStyle(current);
    if (current.hidden || current.getAttribute('aria-hidden') === 'true' || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0') return false;
  }
  return true;
}
/** Checks real mounted DOM. jsdom cannot prove layout or browser top-layer behavior; those are browser scenarios. */
export function inspectConfirm(required: { controller: ConfirmController; checkFocus: boolean }, _optional: Record<string, never> = {}): string[] {
  const c = required.controller, issues: string[] = [];
  const frame = c.frameAttrs.id ? document.getElementById(c.frameAttrs.id) : null;
  if (!frame) return ['missing confirm frame'];
  if (frame.dataset.jiniPart !== 'confirm.dialog' || frame.getAttribute('role') !== 'alertdialog') issues.push('missing alertdialog semantics');
  if (!c.overlayContainer?.contains(frame)) issues.push('frame outside overlay container');
  if (frame.getAttribute('aria-labelledby') !== c.frameAttrs['aria-labelledby']) issues.push('missing title association');
  const cancel = frame.querySelector<HTMLElement>('[data-jini-part="confirm.cancel"]');
  const confirm = frame.querySelector<HTMLElement>('[data-jini-part="confirm.confirm"]');
  for (const [name, element, bag] of [['cancel', cancel, c.cancel], ['confirm', confirm, c.confirm]] as const) {
    if (!element) { issues.push(`missing ${name} action`); continue; }
    if (!element.matches('button,input,[role="button"][tabindex]')) issues.push(`${name} part is not on a focusable action`);
    if (!visible(element)) issues.push(`${name} action hidden`);
    for (const [key, value] of Object.entries(bag.attrs ?? {})) {
      if (value !== undefined && element.getAttribute(key) !== String(value)) issues.push(`${name} did not forward ${key}`);
    }
    if (c.pending && !element.matches(':disabled') && element.getAttribute('aria-disabled') !== 'true') issues.push(`${name} enabled while pending`);
  }
  if (!c.pending && required.checkFocus && cancel && document.activeElement !== cancel) issues.push('initial focus is not cancel');
  if (!c.agentMayConfirm && confirm && [confirm, ...confirm.querySelectorAll('*')].some(element =>
    element.getAttributeNames().some(name => name.startsWith('data-agent-')))) issues.push('human-only confirm published agent metadata');
  if (c.consequence && confirm && !confirm.getAttribute('aria-label')?.includes(c.consequence)) {
    // A concise action name still has to expose the real, visible consequence as its
    // description. An override dropping the associated paragraph must fail the guard.
    const description = c.consequenceAttrs?.id ? document.getElementById(c.consequenceAttrs.id) : null;
    const describedIds = confirm.getAttribute('aria-describedby')?.split(/\s+/) ?? [];
    if (!description || !frame.contains(description) || !visible(description) ||
      !describedIds.includes(description.id) || !description.textContent?.includes(c.consequence)) issues.push('missing consequence label');
  }
  return issues;
}
