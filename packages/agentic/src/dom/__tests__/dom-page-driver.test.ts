import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { findFieldFillRefusal } from '../../guards.js';
import { executePageCapability, type FindElementsResult } from '../../page-executor.js';

import { createDomPageDriver, currentAgentPage } from '../dom-page-driver.js';

/**
 * The mechanical half of page control, against a real (jsdom) DOM.
 *
 * Policy lives in `@jini-ai/agentic`'s `executePageCapability` and is tested there without a
 * browser. What has to be proven *here* is the part that can only be wrong against real nodes:
 * that a handle on a wrapper reaches the control inside it, that a fill React will actually
 * notice, that reading state back does not invent values, and that settling is bounded.
 */

const MARKUP = `
  <section data-agent-page="agent-lab">
    <button data-agent-element="save-button" data-agent-role="button" data-agent-label="Save the draft">Save</button>
    <li data-agent-element="item-water-plants" data-agent-role="checkbox" data-agent-label="Item: Water the plants">
      <label><input type="checkbox" name="water" /> Water the plants</label>
    </li>
    <input data-agent-element="full-name-input" data-agent-role="field" data-agent-label="Full name"
           id="full-name" name="full-name" type="text" value="Ada" />
    <input data-agent-element="account-password" data-agent-role="field" data-agent-label="Password"
           name="password" type="password" value="hunter2" />
    <textarea data-agent-element="bio-input" data-agent-role="field" data-agent-label="Bio">A short bio</textarea>
    <button data-agent-element="disabled-button" data-agent-role="button" data-agent-label="Unavailable" disabled>Nope</button>
    <select data-agent-element="role-select" data-agent-role="field" data-agent-label="Role" name="role" id="role">
      <option value="">Choose one…</option>
      <option value="engineer">Engineer</option>
      <option value="designer">Designer</option>
    </select>
    <select data-agent-element="skills-select" data-agent-role="field" data-agent-label="Skills" name="skills" id="skills" multiple>
      <option value="engineer">Engineer</option>
      <option value="designer">Designer</option>
      <option value="pilot" disabled>Pilot</option>
    </select>
    <span data-agent-element="status-line" data-agent-role="status" data-agent-label="What happened">  Ready.  </span>
    <span data-agent-element="" data-agent-role="status">Untagged</span>
    <span data-agent-role="status">No handle attribute at all</span>
  </section>
`;

let root: HTMLElement;
let navigated: string[];

function makeDriver(overrides: { currentPage?: string } = {}) {
  navigated = [];
  return createDomPageDriver({
    root,
    pages: {
      'agent-lab': () => navigated.push('agent-lab'),
      signup: () => navigated.push('signup'),
    },
    ...overrides,
  });
}

beforeEach(() => {
  root = document.createElement('main');
  root.innerHTML = MARKUP;
  document.body.append(root);
  // jsdom has no layout, so nothing implements this.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  root.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('findElements', () => {
  it('lists every tagged element, skipping ones with no usable handle', async () => {
    const handles = (await makeDriver().findElements({})).map((element) => element.handle);
    expect(handles).toEqual([
      'save-button',
      'item-water-plants',
      'full-name-input',
      'account-password',
      'bio-input',
      'disabled-button',
      'role-select',
      'skills-select',
      'status-line',
    ]);
  });

  it('filters by role', async () => {
    const found = await makeDriver().findElements({ role: 'checkbox' });
    expect(found.map((element) => element.handle)).toEqual(['item-water-plants']);
  });

  it('drops a role the convention does not define rather than reporting it', async () => {
    root.querySelector('[data-agent-element="save-button"]')?.setAttribute('data-agent-role', 'wizard');
    const found = await makeDriver().findElements({});
    expect(found.find((element) => element.handle === 'save-button')?.role).toBeUndefined();
  });

  it('matches a query against both handle and label, case-insensitively', async () => {
    const byHandle = await makeDriver().findElements({ query: 'WATER' });
    expect(byHandle.map((element) => element.handle)).toEqual(['item-water-plants']);
    const byLabel = await makeDriver().findElements({ query: 'save the draft' });
    expect(byLabel.map((element) => element.handle)).toEqual(['save-button']);
  });

  it('falls back to text content when the page tagged an element with no label', async () => {
    const status = root.querySelector('[data-agent-element="status-line"]');
    status?.removeAttribute('data-agent-label');
    const found = await makeDriver().findElements({ query: 'ready' });
    // Raw here on purpose — the executor normalizes and bounds it in exactly one place.
    expect(found[0]?.label).toBe('  Ready.  ');
  });

  it('reads the showing page live, so navigating changes what elements report', async () => {
    const driver = makeDriver();
    expect((await driver.findElements({ role: 'button' }))[0]?.page).toBe('agent-lab');
    root.querySelector('[data-agent-page]')?.setAttribute('data-agent-page', 'signup');
    expect((await driver.findElements({ role: 'button' }))[0]?.page).toBe('signup');
  });

  it('honours a page the host pinned, for a surface that never changes view', async () => {
    const driver = makeDriver({ currentPage: 'pinned' });
    root.querySelector('[data-agent-page]')?.setAttribute('data-agent-page', 'signup');
    expect((await driver.findElements({ role: 'button' }))[0]?.page).toBe('pinned');
  });

  it('reports no page when nothing on the surface is tagged with one', async () => {
    root.querySelector('[data-agent-page]')?.removeAttribute('data-agent-page');
    expect((await makeDriver().findElements({ role: 'button' }))[0]?.page).toBeUndefined();
  });

  it('attributes each element to its own nearest [data-agent-page] ancestor, not the first one in the document', async () => {
    // A host that keeps more than one page section mounted at once (tabs, wizard steps toggled
    // with CSS) previously had every element from every section reported under whichever section
    // happened to be first in the DOM — regressed against by mounting a second section here.
    root.insertAdjacentHTML(
      'beforeend',
      `<section data-agent-page="settings" style="display:none">
        <button data-agent-element="settings-btn" data-agent-role="button">Settings</button>
      </section>`,
    );
    const found = await makeDriver().findElements({});
    const byHandle = Object.fromEntries(found.map((element) => [element.handle, element.page]));
    expect(byHandle['save-button']).toBe('agent-lab');
    expect(byHandle['settings-btn']).toBe('settings');
  });

  it('still finds and reports elements under a page section hidden with display:none — scoping attribution, not gating actions, is the fix', async () => {
    // Deliberate: which page is "active" is the host's own knowledge, not something this driver
    // should invent an answer for. A host that wants hidden sections excluded filters on `page`
    // itself using the (now correct) attribution above.
    root.insertAdjacentHTML(
      'beforeend',
      `<section data-agent-page="settings" style="display:none">
        <button data-agent-element="settings-btn" data-agent-role="button">Settings</button>
      </section>`,
    );
    const found = await makeDriver().findElements({ query: 'settings' });
    expect(found.map((element) => element.handle)).toEqual(['settings-btn']);
  });
});

describe('listPages', () => {
  it('publishes exactly the host-supplied page ids', async () => {
    expect(await makeDriver().listPages()).toEqual(['agent-lab', 'signup']);
  });
});

describe('describeField', () => {
  it('describes an input through the wrapper that carries the handle', async () => {
    expect(await makeDriver().describeField('item-water-plants')).toMatchObject({
      type: 'checkbox',
      name: 'water',
    });
  });

  it('describes a textarea as one', async () => {
    expect(await makeDriver().describeField('bio-input')).toMatchObject({ type: 'textarea' });
  });

  it('reports null for something that is not a field at all', async () => {
    expect(await makeDriver().describeField('save-button')).toBeNull();
  });

  it('lowercases the attributes the guards match on', async () => {
    const input = root.querySelector('[data-agent-element="full-name-input"]');
    input?.setAttribute('autocomplete', 'Current-Password');
    expect(await makeDriver().describeField('full-name-input')).toMatchObject({
      autocomplete: 'current-password',
    });
  });

  it('omits an empty name and id rather than reporting them as blank strings', async () => {
    const bio = await makeDriver().describeField('bio-input');
    expect(bio?.name).toBeUndefined();
    expect(bio?.id).toBeUndefined();
  });

  it('throws for a handle this surface never published', async () => {
    await expect(makeDriver().describeField('not-published'))
      .rejects.toThrow(/no element published as "not-published"/);
  });

  it('reports disabled for a control disabled only via an ancestor <fieldset disabled>', async () => {
    // The `.disabled` IDL property reflects only the element's own attribute — not the "actually
    // disabled" state a form control gets from an ancestor fieldset. A real user cannot type into
    // this field, and its value is excluded from submission, so the fill guard must see it as
    // disabled even though the element carries no `disabled` attribute of its own.
    root.insertAdjacentHTML(
      'beforeend',
      '<fieldset disabled><input data-agent-element="fieldset-disabled-input" name="f" /></fieldset>',
    );
    expect(await makeDriver().describeField('fieldset-disabled-input')).toMatchObject({ disabled: true });
  });
});

describe('accessibleLabels', () => {
  // `name`/`id` are machine names; a CMS or form builder emitting `name="field_47"` next to a
  // visibly-labelled "Card number" leaves the guard nothing to judge unless this is populated.
  //
  // Every source is carried, not just the first that resolves (2026-07-29 audit): first-match
  // resolution let a page hide a sensitive field behind a benign one — see the masking test at
  // the end of this block for the exact markup, which read back a card number in full.
  it('carries aria-label and placeholder together, aria-label first', async () => {
    root.insertAdjacentHTML(
      'beforeend',
      '<input data-agent-element="al-aria" aria-label="Card number" placeholder="1234" name="cc" />',
    );
    expect(await makeDriver().describeField('al-aria')).toMatchObject({ accessibleLabels: ['Card number', '1234'] });
  });

  it('reports placeholder when there is no aria-label', async () => {
    root.insertAdjacentHTML(
      'beforeend',
      '<input data-agent-element="al-placeholder" placeholder="Card number" name="cc" />',
    );
    expect(await makeDriver().describeField('al-placeholder')).toMatchObject({ accessibleLabels: ['Card number'] });
  });

  it('reports an explicit <label for> when there is no aria-label or placeholder', async () => {
    root.insertAdjacentHTML(
      'beforeend',
      '<label for="al-for-target">Card number</label><input id="al-for-target" data-agent-element="al-for" name="cc" />',
    );
    expect(await makeDriver().describeField('al-for')).toMatchObject({ accessibleLabels: ['Card number'] });
  });

  it('reports an ancestor <label> that wraps the control', async () => {
    root.insertAdjacentHTML(
      'beforeend',
      '<label>Card number <input data-agent-element="al-wrap" name="cc" /></label>',
    );
    expect(await makeDriver().describeField('al-wrap')).toMatchObject({ accessibleLabels: ['Card number'] });
  });

  it('reports every <label> associated with a control, not only the first', async () => {
    // The platform allows more than one <label> per control, and `.labels` lists all of them. A
    // page can put the harmless one first.
    root.insertAdjacentHTML(
      'beforeend',
      '<label for="al-multi-target">Optional</label><label for="al-multi-target">Card number</label>'
      + '<input id="al-multi-target" data-agent-element="al-multi" name="f" />',
    );
    expect(await makeDriver().describeField('al-multi')).toMatchObject({
      accessibleLabels: ['Optional', 'Card number'],
    });
  });

  it('resolves the same way for a contenteditable region', async () => {
    root.insertAdjacentHTML(
      'beforeend',
      '<div data-agent-element="al-ce" contenteditable="true" aria-label="Card number"></div>',
    );
    expect(await makeDriver().describeField('al-ce')).toMatchObject({ accessibleLabels: ['Card number'] });
  });

  it('reports no labels at all when nothing on the page names the field', async () => {
    // `bio-input` (from MARKUP) carries no aria-label, placeholder or associated <label>. This is
    // proof the property is actually SET (to an empty list) rather than merely absent:
    // `toMatchObject` treats a missing key differently from a present one.
    expect(await makeDriver().describeField('bio-input')).toMatchObject({ accessibleLabels: [] });
  });

  it('does not repeat one naming source that resolves twice', async () => {
    // A wrapping <label> is also reachable through `.labels`; reporting it twice would be noise
    // in every refusal message built from these.
    root.insertAdjacentHTML(
      'beforeend',
      '<label>Card number <input data-agent-element="al-dupe" name="f" /></label>',
    );
    expect(await makeDriver().describeField('al-dupe')).toMatchObject({ accessibleLabels: ['Card number'] });
  });

  it('end to end: a field named only "field_47" but visibly labelled "Card number" is refused by the fill guard', async () => {
    // This is the real-world case the whole finding is about: a CMS or form builder emits a
    // generated, meaningless `name`/`id`, and only the visible <label> tells a human — or an
    // agent — what the field actually holds. Before this fix, `findFieldFillRefusal` had no way
    // to see that label at all and would have let this field through.
    root.insertAdjacentHTML(
      'beforeend',
      '<label for="field_47">Card number</label><input id="field_47" data-agent-element="al-e2e" name="field_47" />',
    );
    const field = await makeDriver().describeField('al-e2e');
    expect(field).not.toBeNull();
    expect(findFieldFillRefusal(field!)).toBe('suspicious-name');
  });

  // A contenteditable region is not a form control, so it has no `.labels` — the two <label>
  // relationships the platform resolves for free on an <input> have to be walked by hand here.
  // Without that, a rich-text surface visibly labelled "Card number" reaches the guard with
  // nothing to judge, which is exactly the hole the `field_47` case above exists to close.
  it('resolves a wrapping <label> for a contenteditable region, which has no .labels of its own', async () => {
    root.insertAdjacentHTML(
      'beforeend',
      '<label>Card number <div data-agent-element="al-ce-wrap" contenteditable="true" name="field_47"></div></label>',
    );
    expect(await makeDriver().describeField('al-ce-wrap')).toMatchObject({
      type: 'contenteditable',
      accessibleLabels: ['Card number'],
    });
  });

  it('resolves an explicit <label for> pointing at a contenteditable region by id', async () => {
    root.insertAdjacentHTML(
      'beforeend',
      '<label for="ce-cc">Card number</label><div id="ce-cc" data-agent-element="al-ce-for" contenteditable="true"></div>',
    );
    expect(await makeDriver().describeField('al-ce-for')).toMatchObject({ accessibleLabels: ['Card number'] });
  });

  it('skips a <label for> that names a different id and keeps looking', async () => {
    // The manual for-linked walk scans every <label> on the page, so it must actually compare
    // `htmlFor` rather than take the first label it finds.
    root.insertAdjacentHTML(
      'beforeend',
      '<label for="some-other-field">Not this one</label><label for="ce-picked">Card number</label>' +
        '<div id="ce-picked" data-agent-element="al-ce-pick" contenteditable="true"></div>',
    );
    expect(await makeDriver().describeField('al-ce-pick')).toMatchObject({ accessibleLabels: ['Card number'] });
  });

  it('ignores an empty wrapping <label> and still reports the for-linked one', async () => {
    // A wrapper that contributes no text is not a label: reporting it would put `''` in the list
    // and name nothing. The contenteditable itself is empty, so the wrapper's textContent is too.
    root.insertAdjacentHTML(
      'beforeend',
      '<label for="ce-empty-wrap">Card number</label>' +
        '<label><div id="ce-empty-wrap" data-agent-element="al-ce-empty" contenteditable="true"></div></label>',
    );
    expect(await makeDriver().describeField('al-ce-empty')).toMatchObject({ accessibleLabels: ['Card number'] });
  });

  it('reports no accessible label for a hidden input, whose .labels is null rather than an empty list', async () => {
    // `HTMLInputElement.labels` is specified to be null — not an empty NodeList — for
    // `type="hidden"`. Iterating it directly would throw on a field a page can genuinely publish.
    root.insertAdjacentHTML(
      'beforeend',
      '<input type="hidden" data-agent-element="al-hidden" name="csrf" value="t" />',
    );
    expect(await makeDriver().describeField('al-hidden')).toMatchObject({ type: 'hidden', accessibleLabels: [] });
  });

  // The attack this whole plural shape exists to stop, end to end through the executor rather
  // than at the descriptor: the field's machine name says nothing, its placeholder is innocuous,
  // and only the <label> a human reads says "Card number". With first-match resolution the guard
  // saw "Enter value" and reported the card number in full.
  it('a benign placeholder does not mask a sensitive <label> — the value stays withheld', async () => {
    root.insertAdjacentHTML(
      'beforeend',
      '<label for="field_47">Card number</label>'
      + '<input id="field_47" data-agent-element="masked-field" data-agent-label="Payment detail"'
      + ' name="field_47" placeholder="Enter value" value="4111111111111111" />',
    );
    const driver = makeDriver();

    const field = await driver.describeField('masked-field');
    expect(field).not.toBeNull();
    expect(findFieldFillRefusal(field!)).toBe('suspicious-name');

    const result = await executePageCapability(driver, 'page.find_elements', {
      query: 'masked-field',
      withState: true,
    }) as FindElementsResult;
    const masked = result.elements[0]!;
    expect(masked.state?.value).toBeUndefined();
    expect(masked.state?.valueWithheld).toBe('this field name indicates a secret or anti-forgery token');
    expect(JSON.stringify(result)).not.toContain('4111111111111111');
  });

  it('a <select> whose only sensitive signal is its aria-label withholds its value too', async () => {
    // `describeState` builds its own descriptor for a dropdown rather than going through
    // `fieldDescriptorOf`, and that descriptor used to carry no label at all — so the same
    // masking hole existed there independently of the resolution order above.
    root.insertAdjacentHTML(
      'beforeend',
      '<select data-agent-element="cc-select" data-agent-label="Choose" aria-label="Card number" name="f9">'
      + '<option value="4111111111111111">Visa ending 1111</option></select>',
    );
    const driver = makeDriver();
    const result = await executePageCapability(driver, 'page.find_elements', {
      query: 'cc-select',
      withState: true,
    }) as FindElementsResult;
    const state = result.elements[0]!.state;
    expect(state?.value).toBeUndefined();
    expect(state?.valueWithheld).toBe('this field name indicates a secret or anti-forgery token');
    // ...while the option texts a caller needs to pass a valid choice stay readable.
    expect(state?.options).toEqual(['Visa ending 1111']);
  });
});

// Regression (2026-07-29 audit): a contenteditable region's text content IS the field's value.
// Both channels that carry element text — `label` (which falls back to live text when the page
// tagged no `data-agent-label`) and `state.text` — handed it back verbatim on a field the read
// guard refuses.
describe('a contenteditable region holding a secret', () => {
  const secretMarkup =
    '<div data-agent-element="notes" contenteditable="true" name="password">hunter2</div>';

  it('does not report the region\'s contents as its label', async () => {
    root.insertAdjacentHTML('beforeend', secretMarkup);
    const [element] = await makeDriver().findElements({ query: 'notes' });
    expect(element!.label).not.toBe('hunter2');
  });

  it('names the region by its accessible label instead, when the page supplies one', async () => {
    root.insertAdjacentHTML(
      'beforeend',
      '<div data-agent-element="notes2" contenteditable="true" aria-label="Recovery phrase">correct horse</div>',
    );
    const [element] = await makeDriver().findElements({ query: 'notes2' });
    expect(element!.label).toBe('Recovery phrase');
  });

  it('withholds the contents from state.text, through the executor', async () => {
    root.insertAdjacentHTML('beforeend', secretMarkup);
    const result = await executePageCapability(makeDriver(), 'page.find_elements', {
      query: 'notes',
      withState: true,
    }) as FindElementsResult;
    expect(JSON.stringify(result)).not.toContain('hunter2');
    expect(result.elements[0]!.state?.textWithheld)
      .toBe('this field name indicates a secret or anti-forgery token');
  });

  it('still reports the contents of an ordinary editable region', async () => {
    root.insertAdjacentHTML(
      'beforeend',
      '<div data-agent-element="bio-region" contenteditable="true" name="bio" aria-label="Bio">A short bio</div>',
    );
    const result = await executePageCapability(makeDriver(), 'page.find_elements', {
      query: 'bio-region',
      withState: true,
    }) as FindElementsResult;
    expect(result.elements[0]!.state?.text).toBe('A short bio');
    expect(result.elements[0]!.state?.textWithheld).toBeUndefined();
  });

  it('leaves an ordinary element\'s text-derived label untouched', async () => {
    // The label fallback is only withdrawn for editable regions — for everything else, live text
    // is the page's own ontology and is what `status-line` (from MARKUP) relies on.
    root.insertAdjacentHTML('beforeend', '<span data-agent-element="plain-span">Ready.</span>');
    const [element] = await makeDriver().findElements({ query: 'plain-span' });
    expect(element!.label).toBe('Ready.');
  });
});

describe('describeState', () => {
  it('reports a field\'s current value, along with the attributes the read guard needs', async () => {
    expect(await makeDriver().describeState?.('full-name-input')).toMatchObject({
      value: 'Ada',
      field: { type: 'text', name: 'full-name', id: 'full-name' },
    });
  });

  it('reports a password\'s value raw — withholding it is the executor\'s decision, not the driver\'s', async () => {
    // The driver stays mechanical. If it started deciding what is secret, every future driver
    // would have to re-derive the same rule and one of them would get it wrong.
    expect(await makeDriver().describeState?.('account-password')).toMatchObject({
      value: 'hunter2',
      field: { type: 'password' },
    });
  });

  it('reports checked for a checkbox reached through its wrapper', async () => {
    const driver = makeDriver();
    expect(await driver.describeState?.('item-water-plants')).toMatchObject({ checked: false });
    await driver.click('item-water-plants');
    expect(await driver.describeState?.('item-water-plants')).toMatchObject({ checked: true });
  });

  it('reports the element\'s live text, which is what a label deliberately does not carry', async () => {
    expect((await makeDriver().describeState?.('status-line'))?.text).toBe('  Ready.  ');
  });

  it('reports disabled for a control that has the notion, and omits it for one that does not', async () => {
    const driver = makeDriver();
    expect(await driver.describeState?.('disabled-button')).toMatchObject({ disabled: true });
    expect((await driver.describeState?.('status-line'))?.disabled).toBeUndefined();
  });

  it('reports disabled:true for a control disabled only via an ancestor <fieldset disabled>', async () => {
    root.insertAdjacentHTML(
      'beforeend',
      '<fieldset disabled><input data-agent-element="fieldset-disabled-input2" name="f" /></fieldset>',
    );
    expect(await makeDriver().describeState?.('fieldset-disabled-input2')).toMatchObject({ disabled: true });
  });

  it('reports the field descriptor\'s disabled:true for a <select> disabled only via an ancestor fieldset', async () => {
    // Exercises the dropdown branch specifically: `describeState` builds a separate FieldDescriptor
    // for `<select>` rather than routing it through `fieldDescriptorOf`.
    root.insertAdjacentHTML(
      'beforeend',
      '<fieldset disabled><select data-agent-element="fieldset-disabled-select"><option>a</option></select></fieldset>',
    );
    const state = await makeDriver().describeState?.('fieldset-disabled-select');
    expect(state?.field).toMatchObject({ disabled: true });
  });

  it('reports a dropdown\'s value, its options, and a descriptor the read guard can check', async () => {
    // Without `options` a caller has to guess what page.select_option will accept; without a
    // descriptor, a `<select name="secret">` would report its value unguarded.
    expect(await makeDriver().describeState?.('role-select')).toMatchObject({
      value: '',
      options: ['Choose one…', 'Engineer', 'Designer'],
      field: { type: 'select', name: 'role', id: 'role', disabled: false },
    });
  });

  it('omits an unnamed dropdown\'s empty name and id rather than reporting blank strings', async () => {
    const select = root.querySelector('[data-agent-element="role-select"]') as HTMLSelectElement;
    select.removeAttribute('name');
    select.removeAttribute('id');
    const field = (await makeDriver().describeState?.('role-select'))?.field;
    expect(field?.name).toBeUndefined();
    expect(field?.id).toBeUndefined();
  });

  it('omits options for everything that is not a dropdown', async () => {
    expect((await makeDriver().describeState?.('full-name-input'))?.options).toBeUndefined();
    expect((await makeDriver().describeState?.('status-line'))?.options).toBeUndefined();
  });

  it('omits value and field entirely for something that is not a field', async () => {
    const state = await makeDriver().describeState?.('save-button');
    expect(state?.value).toBeUndefined();
    expect(state?.field).toBeUndefined();
  });

  it('reports visibility when the platform can answer, and omits it when it cannot', async () => {
    // jsdom implements no layout and no checkVisibility, so the honest answer there is "unknown"
    // rather than a measurement that would call every element invisible.
    expect((await makeDriver().describeState?.('save-button'))?.visible).toBeUndefined();

    const button = root.querySelector('[data-agent-element="save-button"]') as HTMLElement
      & { checkVisibility?: () => boolean };
    button.checkVisibility = () => false;
    expect((await makeDriver().describeState?.('save-button'))?.visible).toBe(false);
  });

  it('asks checkVisibility to also account for visibility:hidden and opacity:0, not just its defaults', async () => {
    // jsdom does not implement checkVisibility at all, so this cannot prove the *browser's* answer
    // changes — only that the driver asks the right question. Confirmed separately in real
    // Chromium (see the function's own doc comment) that the browser's answer does change: a bare
    // no-arg call reports a `visibility:hidden`/`opacity:0` ancestor as visible, which these
    // options correct.
    const seenOptions: unknown[] = [];
    const button = root.querySelector('[data-agent-element="save-button"]') as HTMLElement
      & { checkVisibility?: (options?: unknown) => boolean };
    button.checkVisibility = (options?: unknown) => {
      seenOptions.push(options);
      return true;
    };
    await makeDriver().describeState?.('save-button');
    // `describeState` reads `visibilityOf` more than once (once to decide whether to include the
    // field, once for the value) — asserting on every recorded call rather than the count, so this
    // stays robust to that detail.
    expect(seenOptions.length).toBeGreaterThan(0);
    for (const options of seenOptions) {
      expect(options).toEqual({ checkOpacity: true, checkVisibilityCSS: true });
    }
  });

  it('returns null, not an error, when the element is gone — which is itself the observation', async () => {
    const driver = makeDriver();
    root.querySelector('[data-agent-element="save-button"]')?.remove();
    expect(await driver.describeState?.('save-button')).toBeNull();
  });

  it('still refuses a malformed handle rather than treating it as a selector', async () => {
    await expect(makeDriver().describeState?.('input[type=password]'))
      .rejects.toThrow(/invalid element handle/);
  });
});

describe('settle', () => {
  it('resolves after two animation frames when the surface is being painted', async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.useFakeTimers();

    let settled = false;
    const pending = makeDriver().settle?.().then(() => { settled = true; });
    frames.shift()?.(0);
    await Promise.resolve();
    expect(settled).toBe(false);
    frames.shift()?.(0);
    await pending;
    expect(settled).toBe(true);
    // The ceiling must not still be pending once frames won the race.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('gives up on the frame and resolves anyway, so a hidden tab cannot hang a write', async () => {
    // A backgrounded tab stops delivering frames entirely — exactly where an agent is left
    // working while the user does something else.
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.useFakeTimers();
    const pending = makeDriver().settle?.();
    await vi.advanceTimersByTimeAsync(200);
    await expect(pending).resolves.toBeUndefined();
  });

  it('falls back to a macrotask where there are no animation frames at all', async () => {
    vi.stubGlobal('requestAnimationFrame', undefined);
    vi.useFakeTimers();
    const pending = makeDriver().settle?.();
    await vi.advanceTimersByTimeAsync(0);
    await expect(pending).resolves.toBeUndefined();
  });
});

describe('highlight', () => {
  it('marks the element, then restores whatever styling was already there', async () => {
    vi.useFakeTimers();
    const element = root.querySelector('[data-agent-element="save-button"]') as HTMLElement;
    element.style.outline = '1px dotted blue';

    await makeDriver().highlight('save-button', 50);
    expect(element.style.outline).toBe('3px solid #e11d48');
    expect(element.scrollIntoView).toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(50);
    expect(element.style.outline).toBe('1px dotted blue');
  });

  it('restarts rather than stacking when the same element is highlighted twice, and still clears', async () => {
    // The restart must not re-snapshot the styling to restore: the marker is already applied by
    // then, so capturing it again would restore the marker and leave the page permanently marked.
    vi.useFakeTimers();
    const element = root.querySelector('[data-agent-element="save-button"]') as HTMLElement;
    const driver = makeDriver();
    await driver.highlight('save-button', 100);
    await vi.advanceTimersByTimeAsync(80);
    await driver.highlight('save-button', 100);
    await vi.advanceTimersByTimeAsync(80);
    // The first timer would have fired by now had it survived.
    expect(element.style.outline).toBe('3px solid #e11d48');
    await vi.advanceTimersByTimeAsync(30);
    expect(element.style.outline).toBe('');
  });

  it('puts back styling the page had of its own across a restart', async () => {
    vi.useFakeTimers();
    const element = root.querySelector('[data-agent-element="save-button"]') as HTMLElement;
    element.style.outline = '1px dotted blue';
    const driver = makeDriver();
    await driver.highlight('save-button', 100);
    await driver.highlight('save-button', 100);
    await vi.advanceTimersByTimeAsync(120);
    expect(element.style.outline).toBe('1px dotted blue');
  });

  it('refuses a node with no style to set, rather than reporting a highlight that never drew', async () => {
    // Previously this silently no-opped — no style change, no error — while page-executor.ts's
    // page.highlight branch has no way to know that and unconditionally reports success. Refusing,
    // like click() already does for the same target, turns a guaranteed false positive into a
    // named error the caller can act on.
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('data-agent-element', 'chart-svg');
    root.append(svg);
    await expect(makeDriver().highlight('chart-svg', 10)).rejects.toThrow(/"chart-svg" is not highlightable/);
  });
});

describe('duplicate data-agent-element handles', () => {
  it('refuses to click a handle published on more than one element, rather than silently acting on the first', async () => {
    // Before this fix, click/fill/etc. resolved via querySelector (first DOM match only) while
    // findElements used querySelectorAll (every match) — so a caller who saw "Second" listed and
    // tried to act on it would silently hit "First" instead, forever, with no signal.
    root.insertAdjacentHTML(
      'beforeend',
      '<button data-agent-element="dup" data-agent-label="First">First</button>'
      + '<button data-agent-element="dup" data-agent-label="Second">Second</button>',
    );
    await expect(makeDriver().click('dup')).rejects.toThrow(/"dup" is published on 2 elements/);
  });

  it('still lists every duplicate in findElements, so the collision is discoverable rather than hidden', async () => {
    root.insertAdjacentHTML(
      'beforeend',
      '<button data-agent-element="dup" data-agent-label="First">First</button>'
      + '<button data-agent-element="dup" data-agent-label="Second">Second</button>',
    );
    const found = await makeDriver().findElements({ query: 'dup' });
    expect(found.map((element) => element.label)).toEqual(['First', 'Second']);
  });

  it('refuses describeState on an ambiguous handle too, instead of quietly reading the first', async () => {
    root.insertAdjacentHTML(
      'beforeend',
      '<button data-agent-element="dup">First</button><button data-agent-element="dup">Second</button>',
    );
    await expect(makeDriver().describeState?.('dup')).rejects.toThrow(/"dup" is published on 2 elements/);
  });

  it('refuses fill on an ambiguous handle too', async () => {
    root.insertAdjacentHTML(
      'beforeend',
      '<input data-agent-element="dup" name="a" /><input data-agent-element="dup" name="b" />',
    );
    await expect(makeDriver().fill('dup', 'x')).rejects.toThrow(/"dup" is published on 2 elements/);
  });
});

describe('scrollTo', () => {
  it('scrolls the handle into view', async () => {
    await makeDriver().scrollTo('status-line');
    const element = root.querySelector('[data-agent-element="status-line"]');
    expect(element?.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
  });
});

describe('click', () => {
  it('clicks the control inside the wrapper that carries the handle', async () => {
    const checkbox = root.querySelector('[data-agent-element="item-water-plants"] input') as HTMLInputElement;
    await makeDriver().click('item-water-plants');
    expect(checkbox.checked).toBe(true);
  });

  it('clicks the handle itself when it is already the control', async () => {
    const button = root.querySelector('[data-agent-element="save-button"]') as HTMLButtonElement;
    const clicked = vi.fn();
    button.addEventListener('click', clicked);
    await makeDriver().click('save-button');
    expect(clicked).toHaveBeenCalledOnce();
  });

  it('refuses a target with nothing clickable in it', async () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('data-agent-element', 'chart-svg');
    root.append(svg);
    await expect(makeDriver().click('chart-svg')).rejects.toThrow(/"chart-svg" is not clickable/);
  });

  it('does not descend into a nested descendant that is itself a separately published handle', async () => {
    // controlOf's descent exists for a plain wrapper like `<li><label><input>`. A nested,
    // independently published control (its own [data-agent-element], own label) is a distinct,
    // separately addressable target — clicking the container must not silently activate it.
    root.insertAdjacentHTML(
      'beforeend',
      '<div data-agent-element="outer" data-agent-label="Outer region">'
      + '<button data-agent-element="inner" data-agent-label="Inner button">Click</button>'
      + '</div>',
    );
    const inner = root.querySelector('[data-agent-element="inner"]') as HTMLButtonElement;
    const clicked = vi.fn();
    inner.addEventListener('click', clicked);
    await makeDriver().click('outer');
    expect(clicked).not.toHaveBeenCalled();
  });
});

describe('fill', () => {
  it('writes through the value setter and dispatches, so a React-controlled input actually updates', async () => {
    // Assigning `control.value` directly updates the DOM but leaves React's tracked value equal
    // to the new one, so React discards the input event and its state stays stale.
    const input = root.querySelector('[data-agent-element="full-name-input"]') as HTMLInputElement;
    const events: string[] = [];
    input.addEventListener('input', () => events.push('input'));
    input.addEventListener('change', () => events.push('change'));

    await makeDriver().fill('full-name-input', 'Ada Lovelace');
    expect(input.value).toBe('Ada Lovelace');
    expect(events).toEqual(['input', 'change']);
  });

  it('fills a textarea', async () => {
    await makeDriver().fill('bio-input', 'Rewritten');
    const textarea = root.querySelector('[data-agent-element="bio-input"]') as HTMLTextAreaElement;
    expect(textarea.value).toBe('Rewritten');
  });

  it('falls back to plain assignment where the prototype exposes no value setter', async () => {
    // The setter route exists for React's benefit; a DOM implementation that does not expose one
    // must still get the text, rather than the fill silently doing nothing.
    const real = Object.getOwnPropertyDescriptor;
    vi.spyOn(Object, 'getOwnPropertyDescriptor').mockImplementation((target, property) =>
      target === HTMLInputElement.prototype && property === 'value'
        ? { configurable: true, get: () => '' }
        : real(target, property));

    await makeDriver().fill('full-name-input', 'Grace');
    const input = root.querySelector('[data-agent-element="full-name-input"]') as HTMLInputElement;
    expect(input.value).toBe('Grace');
  });

  it('refuses a target that is not a field', async () => {
    await expect(makeDriver().fill('save-button', 'x'))
      .rejects.toThrow(/"save-button" is not a fillable field/);
  });
});

describe('selectOption', () => {
  it('chooses by visible text and dispatches, so React notices', async () => {
    const select = root.querySelector('[data-agent-element="role-select"]') as HTMLSelectElement;
    const events: string[] = [];
    select.addEventListener('input', () => events.push('input'));
    select.addEventListener('change', () => events.push('change'));

    await makeDriver().selectOption('role-select', 'Engineer');
    expect(select.value).toBe('engineer');
    expect(events).toEqual(['input', 'change']);
  });

  it('falls back to matching the underlying value', async () => {
    await makeDriver().selectOption('role-select', 'designer');
    const select = root.querySelector('[data-agent-element="role-select"]') as HTMLSelectElement;
    expect(select.value).toBe('designer');
  });

  it('prefers visible text over value when the two collide across options', async () => {
    // A page can name one option's value the same as another's label. Matching value first would
    // quietly select the wrong row.
    const select = root.querySelector('[data-agent-element="role-select"]') as HTMLSelectElement;
    select.innerHTML = '<option value="Engineer">Designer</option><option value="x">Engineer</option>';
    await makeDriver().selectOption('role-select', 'Engineer');
    expect(select.value).toBe('x');
  });

  it('refuses an option that does not exist, and names the ones that do', async () => {
    await expect(makeDriver().selectOption('role-select', 'Astronaut'))
      .rejects.toThrow(/"Astronaut" is not an option of "role-select"\. Available: Choose one…, Engineer, Designer/);
  });

  it('bounds and strips control/bidi characters from both the page\'s option text and the caller\'s option before either reaches a thrown message', async () => {
    // Every other piece of page-authored text this system hands to a model goes through
    // normalizeAgentLabel first. `available` (built from the page's own <option> texts) and the
    // caller-supplied `option` were the one path here that skipped it — a bidi-override plus a
    // 5000-char run would have survived verbatim, exactly the shape chat-core's page.navigate had
    // (commit d1504aa6a) before the identical fix.
    const select = root.querySelector('[data-agent-element="role-select"]') as HTMLSelectElement;
    const bidiOverride = '‮'; // RIGHT-TO-LEFT OVERRIDE
    const pagePayload = `${bidiOverride}${'x'.repeat(5000)}`;
    select.innerHTML = `<option value="v">${pagePayload}</option>`;
    const callerPayload = `${bidiOverride}${'y'.repeat(5000)}`;

    let message = '';
    try {
      await makeDriver().selectOption('role-select', callerPayload);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toContain(bidiOverride);
    expect(message).not.toContain('x'.repeat(5000));
    expect(message).not.toContain('y'.repeat(5000));
    expect(message.length).toBeLessThan(500);
  });

  it('reports (none) when the dropdown has no labelled options at all', async () => {
    const select = root.querySelector('[data-agent-element="role-select"]') as HTMLSelectElement;
    select.innerHTML = '';
    await expect(makeDriver().selectOption('role-select', 'Engineer'))
      .rejects.toThrow(/Available: \(none\)/);
  });

  it('refuses a target that is not a dropdown', async () => {
    await expect(makeDriver().selectOption('full-name-input', 'Engineer'))
      .rejects.toThrow(/"full-name-input" is not a dropdown/);
  });

  it('falls back to plain assignment where the prototype exposes no value setter', async () => {
    const real = Object.getOwnPropertyDescriptor;
    vi.spyOn(Object, 'getOwnPropertyDescriptor').mockImplementation((target, property) =>
      target === HTMLSelectElement.prototype && property === 'value'
        ? { configurable: true, get: () => '' }
        : real(target, property));

    await makeDriver().selectOption('role-select', 'Engineer');
    const select = root.querySelector('[data-agent-element="role-select"]') as HTMLSelectElement;
    expect(select.value).toBe('engineer');
  });
});

describe('selectOption with an explicit `selected`', () => {
  const skillsValues = () => Array.from(
    (root.querySelector('[data-agent-element="skills-select"]') as HTMLSelectElement).selectedOptions,
  ).map((entry) => entry.value);

  it('toggles one option off a multi-select without disturbing the rest', async () => {
    const driver = makeDriver();
    await driver.selectOption('skills-select', 'Engineer');
    await driver.selectOption('skills-select', 'Designer');
    await driver.selectOption('skills-select', 'Engineer', false);
    expect(skillsValues()).toEqual(['designer']);
  });

  it('toggles that option back on', async () => {
    const driver = makeDriver();
    await driver.selectOption('skills-select', 'Engineer');
    await driver.selectOption('skills-select', 'Engineer', false);
    // Checked mid-sequence, not just at the end: without this, a driver that ignored the `false`
    // altogether would still pass, since selecting Engineer again at the end lands on the same
    // final state either way.
    expect(skillsValues()).toEqual([]);
    await driver.selectOption('skills-select', 'Engineer', true);
    expect(skillsValues()).toEqual(['engineer']);
  });

  it('deselecting an option that was never selected is a harmless no-op', async () => {
    await makeDriver().selectOption('skills-select', 'Designer', false);
    expect(skillsValues()).toEqual([]);
  });

  it('still dispatches input and change on a no-op deselect, since the driver ran the write', async () => {
    const select = root.querySelector('[data-agent-element="skills-select"]') as HTMLSelectElement;
    const events: string[] = [];
    select.addEventListener('input', () => events.push('input'));
    select.addEventListener('change', () => events.push('change'));
    await makeDriver().selectOption('skills-select', 'Designer', false);
    expect(events).toEqual(['input', 'change']);
  });

  it('refuses to deselect on a single-select, naming the option and pointing at the alternative', async () => {
    await expect(makeDriver().selectOption('role-select', 'Engineer', false)).rejects.toThrow(
      /"role-select" is a single-select; its choice cannot be removed, only replaced — select a different option instead of deselecting "Engineer"/,
    );
  });

  it('bounds and strips control/bidi characters from the option named in the single-select deselect refusal', async () => {
    // Reaching this branch needs a real match, so the payload has to be an actual option's text —
    // constructed rather than an arbitrary caller string, but the interpolation site is the same
    // unbounded `${option}` this whole item is about.
    const select = root.querySelector('[data-agent-element="role-select"]') as HTMLSelectElement;
    const bidiOverride = '‮';
    const payload = `${bidiOverride}${'z'.repeat(5000)}`;
    select.innerHTML = `<option value="v" selected>${payload}</option>`;

    let message = '';
    try {
      await makeDriver().selectOption('role-select', payload, false);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toContain(bidiOverride);
    expect(message).not.toContain('z'.repeat(5000));
    expect(message.length).toBeLessThan(500);
  });

  it('does not change the single-select\'s value when the deselect is refused', async () => {
    const select = root.querySelector('[data-agent-element="role-select"]') as HTMLSelectElement;
    select.value = 'designer';
    await expect(makeDriver().selectOption('role-select', 'Engineer', false)).rejects.toThrow();
    expect(select.value).toBe('designer');
  });

  it('selected: true on a single-select is unchanged from today\'s behaviour', async () => {
    await makeDriver().selectOption('role-select', 'Engineer', true);
    const select = root.querySelector('[data-agent-element="role-select"]') as HTMLSelectElement;
    expect(select.value).toBe('engineer');
  });

  it('still refuses an option that does not exist when selected: false is requested', async () => {
    await expect(makeDriver().selectOption('skills-select', 'Astronaut', false))
      .rejects.toThrow(/"Astronaut" is not an option of "skills-select"\. Available: Engineer, Designer/);
  });

  it('still refuses a disabled option when selected: false is requested', async () => {
    await expect(makeDriver().selectOption('skills-select', 'Pilot', false))
      .rejects.toThrow(/"Pilot" is not an option of "skills-select"\. Available: Engineer, Designer/);
  });
});

// Regression (2026-07-29 audit): the per-<option> `!entry.disabled` filter above reads like it
// enforces "an agent may only do what a user could," but it only ever looked at each option. The
// CONTROL's own disabled state was never checked, so a `<select disabled>` — and a `<select>`
// inside a `<fieldset disabled>`, which the platform also treats as disabled and excludes from
// form submission — could still be written to, and the write reported as a real change.
describe('selectOption on a dropdown the user cannot touch', () => {
  const disabledMarkup = `
    <select data-agent-element="plan-select" data-agent-label="Plan" name="plan" disabled>
      <option value="free" selected>Free</option>
      <option value="pro">Pro</option>
    </select>
    <fieldset disabled>
      <select data-agent-element="tier-select" data-agent-label="Tier" name="tier">
        <option value="a" selected>A</option>
        <option value="b">B</option>
      </select>
    </fieldset>
  `;

  beforeEach(() => root.insertAdjacentHTML('beforeend', disabledMarkup));

  const valueOf = (handle: string) =>
    (root.querySelector(`[data-agent-element="${handle}"]`) as HTMLSelectElement).value;

  it('refuses a dropdown disabled by its own attribute, and leaves its value alone', async () => {
    await expect(makeDriver().selectOption('plan-select', 'Pro'))
      .rejects.toThrow(/"plan-select" is disabled/);
    expect(valueOf('plan-select')).toBe('free');
  });

  it('refuses a dropdown disabled only by an ancestor <fieldset disabled>', async () => {
    // `.disabled` reflects only the element's own attribute; `:disabled` is the platform's answer
    // for both, and is what decides whether the value reaches form submission at all.
    await expect(makeDriver().selectOption('tier-select', 'B'))
      .rejects.toThrow(/"tier-select" is disabled/);
    expect(valueOf('tier-select')).toBe('a');
  });

  it('refuses before considering whether the option exists at all', async () => {
    // The refusal is about the control, so it must not depend on the caller having named a real
    // option — otherwise the error message leaks which options a disabled control offers.
    await expect(makeDriver().selectOption('plan-select', 'Astronaut'))
      .rejects.toThrow(/"plan-select" is disabled/);
  });

  it('refuses a deselect on a disabled multi-select too', async () => {
    root.insertAdjacentHTML(
      'beforeend',
      '<select data-agent-element="tags-select" name="tags" multiple disabled>'
      + '<option value="x" selected>X</option></select>',
    );
    await expect(makeDriver().selectOption('tags-select', 'X', false))
      .rejects.toThrow(/"tags-select" is disabled/);
    expect(Array.from(
      (root.querySelector('[data-agent-element="tags-select"]') as HTMLSelectElement).selectedOptions,
    ).map((entry) => entry.value)).toEqual(['x']);
  });

  it('still writes to an enabled dropdown, so the refusal is scoped to disabled controls', async () => {
    await makeDriver().selectOption('role-select', 'Engineer');
    expect(valueOf('role-select')).toBe('engineer');
  });
});

describe('navigate', () => {
  it('runs the host-supplied navigation for a published page', async () => {
    await makeDriver().navigate('signup');
    expect(navigated).toEqual(['signup']);
  });

  it('refuses an unpublished page even though the executor checked first', async () => {
    // Belt on the braces: this driver may one day be reachable from something else.
    await expect(makeDriver().navigate('admin')).rejects.toThrow(/"admin" is not a published page/);
  });

  it('bounds and strips control/bidi characters from an unpublished page id, for a caller that reaches this method directly', async () => {
    // The executor sanitizes this same message before this driver-level check is ever reached
    // through it (chat-core commit d1504aa6a). But PageDriver is a public interface, so a caller
    // bypassing the executor hands `page` in unsanitized — same shape of problem, same fix.
    const bidiOverride = '‮';
    const payload = `${bidiOverride}${'w'.repeat(5000)}`;
    let message = '';
    try {
      await makeDriver().navigate(payload);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toContain(bidiOverride);
    expect(message).not.toContain('w'.repeat(5000));
    expect(message.length).toBeLessThan(500);
  });

  // Regression (2026-07-29 audit): the lookup was a bare `pages[page]`, which reaches everything
  // `Object.prototype` contributes. `navigate("constructor")` therefore resolved a function the
  // host never published and called it, reporting a navigation that never happened; and
  // `navigate("__proto__")` resolved a non-callable object and failed with "go is not a function"
  // instead of the refusal this method exists to give.
  it.each(['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__'])(
    'refuses "%s", which a host never published but Object.prototype supplies',
    async (inherited) => {
      await expect(makeDriver().navigate(inherited)).rejects.toThrow(/is not a published page/);
      expect(navigated).toEqual([]);
    },
  );

  it('refuses an inherited name even when the host built its page map from a bare object', async () => {
    // A host that hands over `Object.create(null)` has no inherited names to leak; one that hands
    // over an object literal does. Both must behave identically.
    const driver = createDomPageDriver({ root, pages: Object.assign(Object.create(null), { home: () => {} }) });
    await expect(driver.navigate('constructor')).rejects.toThrow(/is not a published page/);
  });
});

describe('currentAgentPage', () => {
  it('reads the showing page id', () => {
    expect(currentAgentPage(root)).toBe('agent-lab');
  });

  it('reports undefined when nothing is tagged', () => {
    expect(currentAgentPage(document.createElement('div'))).toBeUndefined();
  });
});
