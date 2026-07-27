import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDomPageDriver } from '../dom-page-driver.js';

/**
 * Every element kind a real form can contain, against the real driver.
 *
 * The other driver suite proves each verb works on a representative element. This one asks the
 * different question: given the whole HTML surface, *which* elements can an agent actually
 * operate, and which silently do the wrong thing? A verb that appears to succeed on an element it
 * cannot really drive is worse than one that refuses — the caller records success and moves on.
 *
 * Cases that document a gap say so in their name. They are not aspirational: they assert what the
 * driver does today, so the day someone closes a gap the test fails and has to be updated
 * deliberately.
 */

let root: HTMLElement;

function makeDriver() {
  return createDomPageDriver({ root, pages: { home: () => undefined } });
}

function mount(html: string): void {
  root.innerHTML = `<section data-agent-page="home">${html}</section>`;
}

beforeEach(() => {
  root = document.createElement('main');
  document.body.append(root);
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  root.remove();
  vi.restoreAllMocks();
});

/** The input types whose value is plain text the driver can set directly. */
const TEXTUAL_TYPES: ReadonlyArray<[type: string, value: string]> = [
  ['text', 'plain'],
  ['search', 'query'],
  ['tel', '+44 20 7946 0000'],
  ['url', 'https://example.com'],
  ['email', 'ada@example.com'],
  ['number', '42'],
  ['range', '7'],
  ['color', '#ff0000'],
  ['date', '2026-07-26'],
  ['time', '14:30'],
  ['datetime-local', '2026-07-26T14:30'],
  ['month', '2026-07'],
  ['week', '2026-W30'],
];

describe('fill across every textual input type', () => {
  it.each(TEXTUAL_TYPES)('fills an <input type="%s">', async (type, value) => {
    mount(`<input data-agent-element="target" data-agent-role="field" type="${type}" name="f" />`);
    await makeDriver().fill('target', value);
    expect((root.querySelector('[data-agent-element="target"]') as HTMLInputElement).value).toBe(value);
  });

  it('fills a textarea', async () => {
    mount('<textarea data-agent-element="target" data-agent-role="field" name="f"></textarea>');
    await makeDriver().fill('target', 'multi\nline');
    expect((root.querySelector('[data-agent-element="target"]') as HTMLTextAreaElement).value).toBe('multi\nline');
  });
});

describe('elements the driver reports as fields, and what that implies', () => {
  it('describes every textual type as a field, so the fill guard gets to judge it', async () => {
    for (const [type] of TEXTUAL_TYPES) {
      mount(`<input data-agent-element="target" data-agent-role="field" type="${type}" name="f" />`);
      expect(await makeDriver().describeField('target')).toMatchObject({ type });
    }
  });

  it('describes a file input as a field so the guard can refuse it by type', async () => {
    // The refusal lives in `findFieldFillRefusal` ('file' is a denied type); the driver's job is
    // only to report the type truthfully.
    mount('<input data-agent-element="target" data-agent-role="field" type="file" name="f" />');
    expect(await makeDriver().describeField('target')).toMatchObject({ type: 'file' });
  });

  it('reports a button, link, and plain region as not-a-field', async () => {
    for (const html of [
      '<button data-agent-element="target">Go</button>',
      '<a data-agent-element="target" href="#x">Go</a>',
      '<div data-agent-element="target">text</div>',
    ]) {
      mount(html);
      expect(await makeDriver().describeField('target')).toBeNull();
    }
  });
});

describe('click across the activatable elements', () => {
  it.each([
    ['button', '<button data-agent-element="target">Go</button>'],
    ['link', '<a data-agent-element="target" href="#x">Go</a>'],
    ['submit input', '<input data-agent-element="target" type="submit" value="Go" />'],
    ['reset input', '<input data-agent-element="target" type="reset" value="Reset" />'],
    ['checkbox', '<input data-agent-element="target" type="checkbox" />'],
    ['radio', '<input data-agent-element="target" type="radio" name="r" />'],
  ])('activates a %s', async (_label, html) => {
    mount(html);
    const target = root.querySelector('[data-agent-element="target"]') as HTMLElement;
    const seen = vi.fn();
    target.addEventListener('click', seen);
    await makeDriver().click('target');
    expect(seen).toHaveBeenCalledOnce();
  });

  it('reaches the control inside a wrapper that carries the handle', async () => {
    mount('<li data-agent-element="target"><label><input type="checkbox" /> Item</label></li>');
    await makeDriver().click('target');
    expect((root.querySelector('input') as HTMLInputElement).checked).toBe(true);
  });

  it('toggles a <details> through its <summary>', async () => {
    // Clicking the <details> element itself dispatches an event the platform ignores, so the
    // disclosure would never open while the caller was told the click landed.
    mount('<details data-agent-element="target"><summary>More</summary><p>body</p></details>');
    await makeDriver().click('target');
    expect((root.querySelector('details') as HTMLDetailsElement).open).toBe(true);
  });

  it('toggles the outer <details>, not a nested one that owns the first <summary>', async () => {
    // Only a direct-child <summary> is the disclosure control. Querying the whole subtree finds
    // the inner one first, opens *that*, and reports the outer handle as clicked.
    mount(`<details data-agent-element="outer">
      <details id="inner"><summary>inner</summary><p>inner body</p></details>
      <summary>own</summary>
    </details>`);
    await makeDriver().click('outer');
    expect((root.querySelector('[data-agent-element="outer"]') as HTMLDetailsElement).open).toBe(true);
    expect((root.querySelector('#inner') as HTMLDetailsElement).open).toBe(false);
  });

  it('clicks a <details> that has no <summary>, without descending into its body', async () => {
    // Malformed but legal markup. Falling back to the element itself is the honest answer —
    // there is no disclosure control to press.
    mount('<details data-agent-element="target"><p>body</p></details>');
    const seen = vi.fn();
    (root.querySelector('[data-agent-element="target"]') as HTMLElement).addEventListener('click', seen);
    await makeDriver().click('target');
    expect(seen).toHaveBeenCalledOnce();
  });

  it('addresses an editable region itself rather than a link inside it', async () => {
    mount('<div data-agent-element="target" contenteditable="true"><a href="#x">link</a></div>');
    await makeDriver().fill('target', 'replaced');
    expect((root.querySelector('[data-agent-element="target"]') as HTMLElement).textContent).toBe('replaced');
  });

  it('clicks a plain element, because a div with a handler is a real control', async () => {
    // Deliberately not refused. React attaches onClick to divs constantly, and nothing in the DOM
    // distinguishes one of those from an inert div — refusing would break more than it protects.
    mount('<div data-agent-element="target"><span>just text</span></div>');
    const seen = vi.fn();
    (root.querySelector('[data-agent-element="target"]') as HTMLElement).addEventListener('click', seen);
    await makeDriver().click('target');
    expect(seen).toHaveBeenCalledOnce();
  });
});

describe('state readback across element kinds', () => {
  it('reports checked for both a checkbox and a radio', async () => {
    mount('<input data-agent-element="target" type="checkbox" checked />');
    expect(await makeDriver().describeState?.('target')).toMatchObject({ checked: true });
    mount('<input data-agent-element="target" type="radio" name="r" />');
    expect(await makeDriver().describeState?.('target')).toMatchObject({ checked: false });
  });

  it('reports disabled for every control that has the notion', async () => {
    for (const html of [
      '<button data-agent-element="target" disabled>Go</button>',
      '<input data-agent-element="target" type="text" disabled />',
      '<textarea data-agent-element="target" disabled></textarea>',
      '<select data-agent-element="target" disabled></select>',
    ]) {
      mount(html);
      expect(await makeDriver().describeState?.('target')).toMatchObject({ disabled: true });
    }
  });

  it('reads the live text of output, progress and meter elements', async () => {
    mount('<output data-agent-element="target">42</output>');
    expect((await makeDriver().describeState?.('target'))?.text).toBe('42');
    mount('<progress data-agent-element="target" value="30" max="100">30%</progress>');
    expect((await makeDriver().describeState?.('target'))?.text).toBe('30%');
  });

  it('reads a whole table as text, which is how a caller sees tabular data today', async () => {
    mount('<table data-agent-element="target"><tr><td>a</td><td>b</td></tr></table>');
    expect((await makeDriver().describeState?.('target'))?.text).toContain('a');
  });
});

describe('known gaps — asserted so closing one is a deliberate act', () => {
  it('fills a contenteditable region via the textContent fallback, which is all jsdom can prove', async () => {
    // `fill` now tries `execCommand('insertText'|'delete')` first — see the dedicated describe
    // below — but jsdom implements no editing host and no `execCommand` at all, so every case in
    // *this* file exercises only the fallback that predates it. This one still documents the
    // fallback's own shape: plain `textContent`, `input` only, no `change`.
    mount('<div data-agent-element="target" data-agent-role="field" contenteditable="true"></div>');
    const target = root.querySelector('[data-agent-element="target"]') as HTMLElement;
    const events: string[] = [];
    target.addEventListener('input', () => events.push('input'));
    target.addEventListener('change', () => events.push('change'));

    expect(await makeDriver().describeField('target')).toMatchObject({ type: 'contenteditable' });
    await makeDriver().fill('target', 'hello');
    expect(target.textContent).toBe('hello');
    // `input` only: `change` is a form-control event the platform never fires for this element.
    expect(events).toEqual(['input']);
  });

  it('guards a contenteditable region by name like any other field', async () => {
    // Rich-text surfaces are still fields — a contenteditable named for a card number must be
    // refused exactly as an <input> of that name would be.
    mount('<div data-agent-element="target" data-agent-role="field" contenteditable="true" name="card_number"></div>');
    expect(await makeDriver().describeField('target')).toMatchObject({ name: 'card_number' });
  });

  it('reports the same guard signals for a contenteditable as for an input', async () => {
    // `autocomplete` is no more standard on a div than `name` is, but reading one and not the
    // other refuses `name="card_number"` while accepting `autocomplete="cc-number"` — the same
    // field, spelled the way the denied-token list actually recognises.
    mount('<div data-agent-element="target" contenteditable="true" autocomplete="cc-number" aria-readonly="true"></div>');
    expect(await makeDriver().describeField('target')).toMatchObject({
      autocomplete: 'cc-number',
      readOnly: true,
    });
  });

  it('does not treat a control inside an editable region as fillable text', async () => {
    // jsdom never computes `isContentEditable`, so the inherited-editability branch is invisible
    // to every other test here. A real engine sets it on every descendant — including the Save
    // button of a rich-text editor, whose label `fill` would otherwise overwrite.
    mount('<div contenteditable="true"><button data-agent-element="save">Save</button></div>');
    const button = root.querySelector('[data-agent-element="save"]') as HTMLElement;
    Object.defineProperty(button, 'isContentEditable', { value: true, configurable: true });

    expect(await makeDriver().describeField('save')).toBeNull();
    await expect(makeDriver().fill('save', 'pwned')).rejects.toThrow(/not a fillable field/);
    expect(button.textContent).toBe('Save');
  });

  it('fills a region that inherits its editability from an ancestor', async () => {
    // The other half of that branch: a plain region inside an editor is genuinely editable text,
    // and stays fillable.
    mount('<div contenteditable="true"><p data-agent-element="para">old</p></div>');
    const para = root.querySelector('[data-agent-element="para"]') as HTMLElement;
    Object.defineProperty(para, 'isContentEditable', { value: true, configurable: true });

    await makeDriver().fill('para', 'new');
    expect(para.textContent).toBe('new');
  });

  it('accumulates options on a multi-select instead of replacing the selection', async () => {
    mount(`<select data-agent-element="target" multiple>
      <option value="a">Alpha</option><option value="b">Beta</option>
    </select>`);
    const driver = makeDriver();
    await driver.selectOption('target', 'Alpha');
    await driver.selectOption('target', 'Beta');
    const select = root.querySelector('[data-agent-element="target"]') as HTMLSelectElement;
    expect(Array.from(select.selectedOptions).map((option) => option.value)).toEqual(['a', 'b']);
  });

  it('still replaces the selection on a single-select', async () => {
    mount(`<select data-agent-element="target">
      <option value="a">Alpha</option><option value="b">Beta</option>
    </select>`);
    const driver = makeDriver();
    await driver.selectOption('target', 'Alpha');
    await driver.selectOption('target', 'Beta');
    expect((root.querySelector('[data-agent-element="target"]') as HTMLSelectElement).value).toBe('b');
  });

  it('handles an <optgroup> correctly, because options are read flat', async () => {
    // Not a gap — recorded because grouped options are the case most likely to be got wrong.
    mount(`<select data-agent-element="target">
      <optgroup label="EU"><option value="fr">France</option></optgroup>
      <optgroup label="NA"><option value="ca">Canada</option></optgroup>
    </select>`);
    await makeDriver().selectOption('target', 'Canada');
    expect((root.querySelector('[data-agent-element="target"]') as HTMLSelectElement).value).toBe('ca');
  });

  it('refuses a disabled option, which the user could not have chosen either', async () => {
    mount(`<select data-agent-element="target">
      <option value="a">Alpha</option><option value="b" disabled>Beta</option>
    </select>`);
    await expect(makeDriver().selectOption('target', 'Beta'))
      .rejects.toThrow(/"Beta" is not an option of "target"\. Available: Alpha/);
  });
});

/**
 * `fill` on a contenteditable region, mechanics only jsdom cannot exercise on its own.
 *
 * jsdom has no editing host and no `execCommand`, so these mock `document.execCommand` to prove
 * the driver's *own* logic — what it selects, what it calls, and when it falls back — rather than
 * a real browser's editing behaviour, which only Playwright against a real page can prove. See
 * this package's Playwright verification for that half.
 */
describe('fill on a contenteditable: driving it via execCommand where the platform supports it', () => {
  function mockExecCommand(result: boolean) {
    const execCommand = vi.fn(() => result);
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });
    return execCommand;
  }

  afterEach(() => {
    // `execCommand` is not a jsdom global; remove the mock rather than let it leak into a test
    // that means to exercise the real (absent) jsdom behaviour.
    delete (document as { execCommand?: unknown }).execCommand;
  });

  it('focuses the element, selects its existing contents, then inserts text via execCommand', async () => {
    mount('<div data-agent-element="target" contenteditable="true">old</div>');
    const target = root.querySelector('[data-agent-element="target"]') as HTMLElement;
    const focusSpy = vi.spyOn(target, 'focus');
    const execCommand = mockExecCommand(true);
    const selection = { removeAllRanges: vi.fn(), addRange: vi.fn() };
    vi.spyOn(window, 'getSelection').mockReturnValue(selection as unknown as Selection);
    const rangeSpy = vi.spyOn(document, 'createRange');

    await makeDriver().fill('target', 'new text');

    expect(focusSpy).toHaveBeenCalledOnce();
    expect(rangeSpy).toHaveBeenCalledOnce();
    expect(selection.removeAllRanges).toHaveBeenCalledOnce();
    expect(selection.addRange).toHaveBeenCalledOnce();
    expect(execCommand).toHaveBeenCalledWith('insertText', false, 'new text');
  });

  it('does not fall back to textContent when execCommand reports it ran', async () => {
    mount('<div data-agent-element="target" contenteditable="true">old</div>');
    const target = root.querySelector('[data-agent-element="target"]') as HTMLElement;
    mockExecCommand(true);
    const events: string[] = [];
    target.addEventListener('input', () => events.push('input'));

    await makeDriver().fill('target', 'new text');

    // A real browser's execCommand would update the DOM and fire input/beforeinput itself; this
    // mock does neither, so an unchanged DOM and no synthetic event together prove the driver took
    // execCommand's word for it rather than also running the fallback.
    expect(target.textContent).toBe('old');
    expect(events).toEqual([]);
  });

  it('issues delete rather than insertText for an empty replacement', async () => {
    mount('<div data-agent-element="target" contenteditable="true">old</div>');
    const execCommand = mockExecCommand(true);
    await makeDriver().fill('target', '');
    expect(execCommand).toHaveBeenCalledWith('delete');
    expect(execCommand).not.toHaveBeenCalledWith('insertText', expect.anything(), expect.anything());
  });

  it('falls back to textContent + synthetic input when execCommand reports it did not run', async () => {
    mount('<div data-agent-element="target" contenteditable="true">old</div>');
    const target = root.querySelector('[data-agent-element="target"]') as HTMLElement;
    mockExecCommand(false);
    const events: string[] = [];
    target.addEventListener('input', () => events.push('input'));

    await makeDriver().fill('target', 'fallback text');

    expect(target.textContent).toBe('fallback text');
    expect(events).toEqual(['input']);
  });

  it('falls back the same way when the platform has no execCommand at all, as jsdom does not', async () => {
    mount('<div data-agent-element="target" contenteditable="true">old</div>');
    expect(typeof document.execCommand).toBe('undefined');
    await makeDriver().fill('target', 'hello');
    const target = root.querySelector('[data-agent-element="target"]') as HTMLElement;
    expect(target.textContent).toBe('hello');
  });
});
