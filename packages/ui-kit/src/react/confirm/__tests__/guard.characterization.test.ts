import { afterEach, describe, expect, it } from 'vitest';
import { inspectConfirm } from '../guard.js';
import type { ConfirmController } from '../../types.js';

function fixture(required: Partial<ConfirmController> = {}, _optional: Record<string, never> = {}) {
  const overlay = document.createElement('div');
  overlay.innerHTML = '<div id="frame" role="alertdialog" data-jini-part="confirm.dialog" aria-labelledby="title"><h2 id="title">Delete</h2><p id="consequence">Removes data</p><button data-jini-part="confirm.cancel">Cancel</button><button data-jini-part="confirm.confirm">Delete</button></div>';
  document.body.append(overlay);
  const frame = overlay.querySelector<HTMLElement>('#frame')!;
  const cancel = frame.querySelector<HTMLButtonElement>('[data-jini-part="confirm.cancel"]')!;
  const confirm = frame.querySelector<HTMLButtonElement>('[data-jini-part="confirm.confirm"]')!;
  const description = frame.querySelector<HTMLElement>('#consequence')!;
  cancel.focus();
  const controller: ConfirmController = { open: true, pending: false, title: 'Delete', body: null, consequence: undefined, error: null,
    titleAttrs: {}, frameAttrs: { id: 'frame', role: 'alertdialog', 'aria-labelledby': 'title' }, cancel: { children: 'Cancel' }, confirm: { children: 'Delete' },
    boundaryRef: { current: null }, overlayContainer: overlay, agentMayConfirm: true, requestDismiss: () => true, focusInitial() {}, ...required };
  return { overlay, frame, cancel, confirm, description, controller, inspect: () => inspectConfirm({ controller, checkFocus: true }) };
}
afterEach(() => { document.body.innerHTML = ''; });

describe('confirmation guard characterization', () => {
  it('accepts an intact frame and reports a missing or unspecified frame id first', () => {
    expect(fixture().inspect()).toEqual([]);
    document.body.innerHTML = '';
    const f = fixture(); f.frame.remove();
    expect(f.inspect()).toEqual(['missing confirm frame']);
    expect(inspectConfirm({ controller: { ...f.controller, frameAttrs: { role: 'alertdialog', 'aria-labelledby': 'title' } }, checkFocus: true })).toEqual(['missing confirm frame']);
  });

  it.each(['part', 'role', 'overlay', 'title'] as const)('keeps the frame %s check', problem => {
    const f = fixture();
    const expected = { part: 'missing alertdialog semantics', role: 'missing alertdialog semantics', overlay: 'frame outside overlay container', title: 'missing title association' };
    if (problem === 'part') f.frame.dataset.jiniPart = 'other';
    if (problem === 'role') f.frame.setAttribute('role', 'dialog');
    if (problem === 'overlay') document.body.append(f.frame);
    if (problem === 'title') f.frame.setAttribute('aria-labelledby', 'wrong');
    f.cancel.focus();
    expect(f.inspect()).toEqual([expected[problem]]);
  });

  it('keeps issue ordering across frame, action, focus, metadata and consequence checks', () => {
    const f = fixture({ pending: false, agentMayConfirm: false, consequence: 'Removes data' });
    f.frame.setAttribute('role', 'dialog'); f.frame.setAttribute('aria-labelledby', 'wrong');
    f.cancel.remove(); f.confirm.setAttribute('data-agent-element', 'erase'); f.confirm.hidden = true;
    expect(f.inspect()).toEqual(['missing alertdialog semantics', 'missing title association', 'missing cancel action', 'confirm action hidden', 'human-only confirm published agent metadata', 'missing consequence label']);
  });

  it.each(['cancel', 'confirm'] as const)('keeps missing, focusable and forwarded-attribute checks for %s', name => {
    const f = fixture({ [name]: { children: name, attrs: { 'data-kept': 'yes', 'data-omitted': undefined } } });
    f[name].setAttribute('data-kept', 'yes');
    expect(f.inspect()).toEqual([]);
    f[name].removeAttribute('data-kept');
    expect(f.inspect()).toEqual([`${name} did not forward data-kept`]);
    f[name].setAttribute('data-kept', 'yes');
    const span = document.createElement('span'); span.dataset.jiniPart = `confirm.${name}`; span.setAttribute('data-kept', 'yes'); f[name].replaceWith(span);
    expect(inspectConfirm({ controller: f.controller, checkFocus: false })).toEqual([`${name} part is not on a focusable action`]);
    span.setAttribute('role', 'button'); span.tabIndex = 0;
    expect(inspectConfirm({ controller: f.controller, checkFocus: false })).toEqual([]);
    span.remove();
    expect(inspectConfirm({ controller: f.controller, checkFocus: false })).toEqual([`missing ${name} action`]);
  });

  it.each(['hidden', 'aria-hidden', 'display', 'visibility', 'collapse', 'opacity'] as const)('keeps ancestor visibility rejection for %s', style => {
    const f = fixture();
    if (style === 'hidden') f.overlay.hidden = true;
    if (style === 'aria-hidden') f.overlay.setAttribute('aria-hidden', 'true');
    if (style === 'display') f.overlay.style.display = 'none';
    if (style === 'visibility') f.overlay.style.visibility = 'hidden';
    if (style === 'collapse') f.overlay.style.visibility = 'collapse';
    if (style === 'opacity') f.overlay.style.opacity = '0';
    expect(f.inspect()).toEqual(['cancel action hidden', 'confirm action hidden']);
  });

  it('keeps pending disabling, optional focus checks, and absent overlay behavior', () => {
    const f = fixture({ pending: true }); f.confirm.focus();
    expect(f.inspect()).toEqual(['cancel enabled while pending', 'confirm enabled while pending']);
    f.cancel.disabled = true; f.confirm.setAttribute('aria-disabled', 'true');
    expect(f.inspect()).toEqual([]);
    const ready = { ...f.controller, pending: false };
    expect(inspectConfirm({ controller: ready, checkFocus: true })).toEqual(['initial focus is not cancel']);
    expect(inspectConfirm({ controller: ready, checkFocus: false })).toEqual([]);
    expect(inspectConfirm({ controller: { ...ready, overlayContainer: null }, checkFocus: false })).toEqual(['frame outside overlay container']);
  });

  it.each(['self', 'descendant'] as const)('rejects human-only metadata on %s', where => {
    const f = fixture({ agentMayConfirm: false });
    expect(f.inspect()).toEqual([]);
    const target = where === 'self' ? f.confirm : f.confirm.appendChild(document.createElement('span'));
    target.setAttribute('data-agent-label', 'Erase');
    expect(f.inspect()).toEqual(['human-only confirm published agent metadata']);
    expect(inspectConfirm({ controller: { ...f.controller, agentMayConfirm: true }, checkFocus: true })).toEqual([]);
    f.confirm.remove();
    expect(f.inspect()).toEqual(['missing confirm action']);
  });

  it('accepts consequence in the label or a visible in-frame associated paragraph', () => {
    const f = fixture({ consequence: 'Removes data', consequenceAttrs: { id: 'consequence' } });
    f.confirm.setAttribute('aria-label', 'Delete — Removes data');
    expect(f.inspect()).toEqual([]);
    f.confirm.setAttribute('aria-label', 'Delete'); f.confirm.setAttribute('aria-describedby', 'other consequence');
    expect(f.inspect()).toEqual([]);
  });

  it.each(['no-id', 'missing', 'outside', 'hidden', 'unassociated', 'wrong-text', 'empty-text'] as const)('rejects a consequence description that is %s', problem => {
    const f = fixture({ consequence: 'Removes data', consequenceAttrs: problem === 'no-id' ? {} : { id: 'consequence' } });
    f.confirm.setAttribute('aria-describedby', 'consequence');
    if (problem === 'missing') f.description.remove();
    if (problem === 'outside') f.overlay.append(f.description);
    if (problem === 'hidden') f.description.hidden = true;
    if (problem === 'unassociated') f.confirm.removeAttribute('aria-describedby');
    if (problem === 'wrong-text') f.description.textContent = 'Something else';
    if (problem === 'empty-text') f.description.textContent = '';
    expect(f.inspect()).toEqual(['missing consequence label']);
  });
});
