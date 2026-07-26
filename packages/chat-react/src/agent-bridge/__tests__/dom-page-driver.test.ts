import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDomPageDriver, currentAgentPage } from '../dom-page-driver.js';

/**
 * The mechanical half of page control, against a real (jsdom) DOM.
 *
 * Policy lives in `@jini/chat-core`'s `executePageCapability` and is tested there without a
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

  it('does nothing for a node with no style to set', async () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('data-agent-element', 'chart-svg');
    root.append(svg);
    await expect(makeDriver().highlight('chart-svg', 10)).resolves.toBeUndefined();
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

describe('navigate', () => {
  it('runs the host-supplied navigation for a published page', async () => {
    await makeDriver().navigate('signup');
    expect(navigated).toEqual(['signup']);
  });

  it('refuses an unpublished page even though the executor checked first', async () => {
    // Belt on the braces: this driver may one day be reachable from something else.
    await expect(makeDriver().navigate('admin')).rejects.toThrow(/"admin" is not a published page/);
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
