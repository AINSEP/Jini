import { afterEach, describe, expect, it } from 'vitest';
import { inspectConfirm } from '../confirm/guard.js';
import type { ConfirmController } from '../types.js';

// The guard reads real mounted DOM, so each case mounts plain markup and a hand-built controller
// view model; nothing here is mocked.
const FRAME = `<div id="frame" data-jini-part="confirm.dialog" role="alertdialog" aria-labelledby="title">
  <h2 id="title">Delete files</h2>
  <p id="consequence">Removes 3 files forever</p>
  <button data-jini-part="confirm.cancel">Cancel</button>
  <button data-jini-part="confirm.confirm">Delete</button>
</div>`;

function mount(html = FRAME) {
  const overlay = document.createElement('div');
  overlay.id = 'overlay';
  overlay.innerHTML = html;
  document.body.append(overlay);
  return overlay;
}
function controller(overrides: Partial<ConfirmController> = {}): ConfirmController {
  return {
    open: true, pending: false, title: 'Delete files', body: null, consequence: undefined, error: null,
    titleAttrs: {}, frameAttrs: { id: 'frame', role: 'alertdialog', 'aria-labelledby': 'title' },
    cancel: { children: 'Cancel' }, confirm: { children: 'Delete' }, boundaryRef: { current: null },
    overlayContainer: document.getElementById('overlay'), agentMayConfirm: true,
    requestDismiss: () => true, focusInitial: () => {},
    ...overrides,
  };
}
const part = (name: string) => document.querySelector<HTMLElement>(`[data-jini-part="${name}"]`)!;

afterEach(() => { document.body.innerHTML = ''; });

describe('inspectConfirm', () => {
  it('passes a well-formed confirm with focus on cancel', () => {
    mount();
    part('confirm.cancel').focus();
    expect(inspectConfirm({ controller: controller(), checkFocus: true })).toEqual([]);
  });

  it('reports a missing frame when the controller has no id or the id is not mounted', () => {
    mount();
    expect(inspectConfirm({ controller: controller({ frameAttrs: { role: 'alertdialog', 'aria-labelledby': 'title' } }), checkFocus: false }))
      .toEqual(['missing confirm frame']);
    expect(inspectConfirm({ controller: controller({ frameAttrs: { id: 'elsewhere', role: 'alertdialog', 'aria-labelledby': 'title' } }), checkFocus: false }))
      .toEqual(['missing confirm frame']);
  });

  it('reports lost semantics, a frame outside the overlay, and a broken title association', () => {
    mount(FRAME.replace('data-jini-part="confirm.dialog"', 'data-jini-part="kit.dialog"'));
    expect(inspectConfirm({ controller: controller(), checkFocus: false })).toEqual(['missing alertdialog semantics']);
    document.body.innerHTML = '';
    mount(FRAME.replace('role="alertdialog"', 'role="dialog"').replace('aria-labelledby="title"', 'aria-labelledby="other"'));
    expect(inspectConfirm({ controller: controller({ overlayContainer: null }), checkFocus: false }))
      .toEqual(['missing alertdialog semantics', 'frame outside overlay container', 'missing title association']);
  });

  it('reports missing actions and actions placed on non-focusable elements', () => {
    mount(FRAME.replace('<button data-jini-part="confirm.cancel">Cancel</button>', '')
      .replace('<button data-jini-part="confirm.confirm">Delete</button>', '<span data-jini-part="confirm.confirm">Delete</span>'));
    expect(inspectConfirm({ controller: controller(), checkFocus: true }))
      .toEqual(['missing cancel action', 'confirm part is not on a focusable action']);
  });

  it.each([
    ['the hidden attribute', (el: HTMLElement) => { el.hidden = true; }],
    ['aria-hidden on an ancestor', (el: HTMLElement) => { el.parentElement!.setAttribute('aria-hidden', 'true'); }],
    ['display none', (el: HTMLElement) => { el.style.display = 'none'; }],
    ['visibility hidden', (el: HTMLElement) => { el.style.visibility = 'hidden'; }],
    ['visibility collapse', (el: HTMLElement) => { el.style.visibility = 'collapse'; }],
    ['opacity 0', (el: HTMLElement) => { el.style.opacity = '0'; }],
  ])('reports an action hidden by %s', (_name, hide) => {
    mount();
    hide(part('confirm.confirm'));
    expect(inspectConfirm({ controller: controller(), checkFocus: false })).toContain('confirm action hidden');
  });

  it('requires every defined attr to be forwarded and ignores undefined ones', () => {
    mount();
    part('confirm.confirm').setAttribute('data-agent-element', 'delete');
    const c = controller({
      cancel: { children: 'Cancel', attrs: { 'data-agent-element': 'cancel', 'data-skipped': undefined } },
      confirm: { children: 'Delete', attrs: { 'data-agent-element': 'delete' } },
    });
    expect(inspectConfirm({ controller: c, checkFocus: false })).toEqual(['cancel did not forward data-agent-element']);
  });

  it('flags enabled actions while pending and accepts disabled or aria-disabled ones', () => {
    mount();
    // Pending also suspends the initial-focus check, so nothing else is reported.
    expect(inspectConfirm({ controller: controller({ pending: true }), checkFocus: true }))
      .toEqual(['cancel enabled while pending', 'confirm enabled while pending']);
    (part('confirm.cancel') as HTMLButtonElement).disabled = true;
    part('confirm.confirm').setAttribute('aria-disabled', 'true');
    expect(inspectConfirm({ controller: controller({ pending: true }), checkFocus: true })).toEqual([]);
  });

  it('checks initial focus only when asked', () => {
    mount();
    part('confirm.confirm').focus();
    expect(inspectConfirm({ controller: controller(), checkFocus: true })).toEqual(['initial focus is not cancel']);
    expect(inspectConfirm({ controller: controller(), checkFocus: false })).toEqual([]);
  });

  it('rejects agent metadata on a human-only confirm, including on descendants', () => {
    mount();
    const human = controller({ agentMayConfirm: false });
    expect(inspectConfirm({ controller: human, checkFocus: false })).toEqual([]);
    part('confirm.confirm').innerHTML = '<span data-agent-label="Delete">Delete</span>';
    expect(inspectConfirm({ controller: human, checkFocus: false })).toEqual(['human-only confirm published agent metadata']);
    expect(inspectConfirm({ controller: controller({ agentMayConfirm: true }), checkFocus: false })).toEqual([]);
    part('confirm.confirm').innerHTML = 'Delete';
    part('confirm.confirm').setAttribute('data-agent-element', 'delete');
    expect(inspectConfirm({ controller: human, checkFocus: false })).toEqual(['human-only confirm published agent metadata']);
  });

  describe('consequence', () => {
    const consequence = 'Removes 3 files forever';
    const described = () => part('confirm.confirm').setAttribute('aria-describedby', 'other consequence');

    it('is satisfied by an accessible name that already states it', () => {
      mount();
      part('confirm.confirm').setAttribute('aria-label', `Delete. ${consequence}`);
      expect(inspectConfirm({ controller: controller({ consequence }), checkFocus: false })).toEqual([]);
    });

    it('is satisfied by a visible, in-frame description the confirm points at', () => {
      mount();
      described();
      expect(inspectConfirm({ controller: controller({ consequence, consequenceAttrs: { id: 'consequence' } }), checkFocus: false })).toEqual([]);
    });

    it.each([
      ['no description id', () => {}, {}],
      ['an id that is not mounted', () => {}, { id: 'gone' }],
      ['a description outside the frame', () => {
        const outside = document.createElement('p'); outside.id = 'outside'; outside.textContent = consequence; document.body.append(outside);
      }, { id: 'outside' }],
      ['a hidden description', () => { part('confirm.confirm').closest('div')!.querySelector<HTMLElement>('#consequence')!.hidden = true; }, { id: 'consequence' }],
      ['a description the confirm does not reference', () => { part('confirm.confirm').removeAttribute('aria-describedby'); }, { id: 'consequence' }],
      ['a description whose text drops the consequence', () => { document.getElementById('consequence')!.textContent = 'Removes files'; }, { id: 'consequence' }],
    ])('is missing with %s', (_name, arrange, consequenceAttrs) => {
      mount();
      described();
      arrange();
      expect(inspectConfirm({ controller: controller({ consequence, consequenceAttrs }), checkFocus: false })).toEqual(['missing consequence label']);
    });
  });
});
