import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDomPageDriver } from '../dom-page-driver.js';

let root: HTMLElement;
beforeEach(() => {
  root = document.createElement('main');
  document.body.append(root);
});
afterEach(() => {
  root.remove();
  vi.restoreAllMocks();
});

function mount({ markup }: { markup: string }, _optional: Record<string, never> = {}) {
  root.innerHTML = markup;
  return createDomPageDriver({ root, pages: {} });
}

describe('L183 field descriptor characterization', () => {
  it.each(['', 'plaintext-only', 'true'])('describes an editable region with contenteditable=%s', async (editable) => {
    const driver = mount({ markup: `<div data-agent-element="target" contenteditable="${editable}"
      autocomplete="CC-NUMBER" name="field_47" id="card" aria-label="Card number"
      placeholder="Enter value" aria-readonly="true" aria-disabled="true">private value</div>` });
    expect(await driver.describeField({ handle: 'target' })).toEqual({
      type: 'contenteditable', autocomplete: 'cc-number', name: 'field_47', id: 'card',
      accessibleLabels: ['Card number', 'Enter value'], readOnly: true, disabled: true,
    });
  });

  it.each([
    '<div data-agent-element="target" contenteditable="true">draft</div>',
    '<div data-agent-element="target" contenteditable="true" autocomplete="" name="" id="" aria-readonly="TRUE" aria-disabled="false">draft</div>',
  ])('keeps empty editable attributes undefined and ARIA flags case-sensitive: %s', async (markup) => {
    const driver = mount({ markup });
    expect(await driver.describeField({ handle: 'target' })).toEqual({
      type: 'contenteditable', autocomplete: undefined, name: undefined, id: undefined,
      accessibleLabels: [], readOnly: false, disabled: false,
    });
  });

  it.each([
    '<input data-agent-element="target" type="EMAIL" autocomplete="EMAIL" name="contact" id="email" readonly disabled aria-label="Email">',
    '<textarea data-agent-element="target" autocomplete="EMAIL" name="contact" id="email" readonly disabled aria-label="Email"></textarea>',
  ])('preserves native attributes for %s', async (markup) => {
    const driver = mount({ markup });
    expect(await driver.describeField({ handle: 'target' })).toEqual({
      type: markup.startsWith('<input') ? 'email' : 'textarea', autocomplete: 'email',
      name: 'contact', id: 'email', accessibleLabels: ['Email'], readOnly: true, disabled: true,
    });
  });

  it.each([undefined, ''])('preserves native autocomplete=%s independently of empty name/id', async (autocomplete) => {
    const driver = mount({ markup: '<input data-agent-element="target">' });
    const control = root.querySelector('input')!;
    if (autocomplete !== undefined) control.setAttribute('autocomplete', autocomplete);
    expect(await driver.describeField({ handle: 'target' })).toEqual({
      type: 'text', autocomplete, name: undefined, id: undefined,
      accessibleLabels: [], readOnly: false, disabled: false,
    });
  });

  it.each([
    '<div data-agent-element="target" contenteditable="false">plain</div>',
    '<button data-agent-element="target" contenteditable="true">Save</button>',
    '<svg data-agent-element="target"></svg>',
  ])('returns no text-field descriptor for %s', async (markup) => {
    expect(await mount({ markup }).describeField({ handle: 'target' })).toBeNull();
  });
});

describe('L183 raw state characterization', () => {
  it.each([
    ['<input data-agent-element="target" value="Ada">', { text: '', value: 'Ada', disabled: false,
      field: { type: 'text', autocomplete: undefined, name: undefined, id: undefined, accessibleLabels: [], readOnly: false, disabled: false } }],
    ['<textarea data-agent-element="target">draft</textarea>', { text: 'draft', value: 'draft', disabled: false,
      field: { type: 'textarea', autocomplete: undefined, name: undefined, id: undefined, accessibleLabels: [], readOnly: false, disabled: false } }],
    ['<input data-agent-element="target" type="checkbox" checked>', { text: '', value: 'on', checked: true, disabled: false,
      field: { type: 'checkbox', autocomplete: undefined, name: undefined, id: undefined, accessibleLabels: [], readOnly: false, disabled: false } }],
    ['<input data-agent-element="target" type="radio">', { text: '', value: 'on', checked: false, disabled: false,
      field: { type: 'radio', autocomplete: undefined, name: undefined, id: undefined, accessibleLabels: [], readOnly: false, disabled: false } }],
    ['<div data-agent-element="target" contenteditable="true">draft</div>', { text: 'draft', textIsValue: true,
      field: { type: 'contenteditable', autocomplete: undefined, name: undefined, id: undefined, accessibleLabels: [], readOnly: false, disabled: false } }],
    ['<button data-agent-element="target" disabled>Save</button>', { text: 'Save', disabled: true }],
    ['<span data-agent-element="target"> Ready <b data-agent-private>secret</b></span>', { text: ' Ready ' }],
  ])('retains exactly the applicable raw properties for %s', async (markup, expected) => {
    expect(await mount({ markup }).describeState!({ handle: 'target' })).toEqual(expected);
  });

  it('reports select labels, raw value and nonblank option texts, including disabled options', async () => {
    const driver = mount({ markup: '<fieldset disabled><select data-agent-element="target" name="f9" id="card" aria-label="Card number"><option value="empty"> </option><option value="b" selected> Beta </option><option disabled>Gamma</option></select></fieldset>' });
    expect(await driver.describeState!({ handle: 'target' })).toEqual({
      text: '  Beta Gamma', value: 'b', disabled: true, options: ['Beta', 'Gamma'],
      field: { type: 'select', name: 'f9', id: 'card', accessibleLabels: ['Card number'], disabled: true },
    });
    expect(await driver.describeField({ handle: 'target' })).toBeNull();
  });

  it('keeps an unnamed empty dropdown readable with an empty value and option list', async () => {
    const driver = mount({ markup: '<select data-agent-element="target"></select>' });
    expect(await driver.describeState!({ handle: 'target' })).toEqual({
      text: '', value: '', disabled: false, options: [],
      field: { type: 'select', name: undefined, id: undefined, accessibleLabels: [], disabled: false },
    });
  });

  it.each([true, false])('reports platform visibility=%s with opacity and CSS checks enabled', async (visible) => {
    const driver = mount({ markup: '<span data-agent-element="target">Ready</span>' });
    const target = root.querySelector('span')!;
    const checkVisibility = vi.fn((_options?: CheckVisibilityOptions) => visible);
    Object.defineProperty(target, 'checkVisibility', { value: checkVisibility, configurable: true });
    expect(await driver.describeState!({ handle: 'target' })).toEqual({ text: 'Ready', visible });
    expect(checkVisibility).toHaveBeenCalledWith({ checkOpacity: true, checkVisibilityCSS: true });
    expect(checkVisibility.mock.contexts).toEqual([target, target]);
  });

  it('returns null for missing and private handles and refuses invalid or ambiguous ones', async () => {
    const driver = mount({ markup: '<div data-agent-private><input data-agent-element="hidden"></div><span data-agent-element="duplicate"></span><span data-agent-element="duplicate"></span>' });
    expect(await driver.describeState!({ handle: 'missing' })).toBeNull();
    expect(await driver.describeState!({ handle: 'hidden' })).toBeNull();
    await expect(driver.describeState!({ handle: 'input[type=password]' })).rejects.toThrow('invalid element handle');
    await expect(driver.describeState!({ handle: 'duplicate' })).rejects.toThrow('"duplicate" is published on 2 elements');
  });
});

describe('L183 option selection characterization', () => {
  const markup = '<select data-agent-element="target"><option value="a">Alpha</option><option value="Beta">Collision</option><option value="b"> Beta </option><option value="c" disabled>Blocked</option></select>';

  it.each([['Beta', 'b'], ['Collision', 'Beta'], ['b', 'b']])('resolves %s to %s and emits bubbling input before change', async (option, expected) => {
    const driver = mount({ markup });
    const select = root.querySelector('select')!;
    const seen: string[] = [];
    root.addEventListener('input', () => seen.push(`input:${select.value}`));
    root.addEventListener('change', () => seen.push(`change:${select.value}`));
    await driver.selectOption({ handle: 'target', option });
    expect(select.value).toBe(expected);
    expect(seen).toEqual([`input:${expected}`, `change:${expected}`]);
  });

  it('falls back to assignment when the prototype value setter is absent', async () => {
    const driver = mount({ markup });
    const getDescriptor = Object.getOwnPropertyDescriptor;
    vi.spyOn(Object, 'getOwnPropertyDescriptor').mockImplementation((target, key) =>
      target === HTMLSelectElement.prototype && key === 'value'
        ? undefined : getDescriptor(target, key));
    await driver.selectOption({ handle: 'target', option: 'Beta' });
    expect(root.querySelector('select')!.value).toBe('b');
  });

  it.each(['Missing', 'Blocked'])('refuses %s without changing the selection or emitting events', async (option) => {
    const driver = mount({ markup });
    const event = vi.fn();
    root.addEventListener('input', event);
    root.addEventListener('change', event);
    await expect(driver.selectOption({ handle: 'target', option })).rejects.toThrow(
      `"${option}" is not an option of "target". Available: Alpha, Collision, Beta`,
    );
    expect(root.querySelector('select')!.value).toBe('a');
    expect(event).not.toHaveBeenCalled();
  });

  it.each(['', '<option> </option><option disabled>Hidden choice</option>'])('reports no available options for %s', async (options) => {
    const driver = mount({ markup: `<select data-agent-element="target">${options}</select>` });
    await expect(driver.selectOption({ handle: 'target', option: 'Missing' })).rejects.toThrow(
      '"Missing" is not an option of "target". Available: (none)',
    );
  });

  it('strips control and bidi characters and bounds option refusal labels', async () => {
    const driver = mount({ markup: '<select data-agent-element="target"><option>\u202eAlpha\u0001</option></select>' });
    await expect(driver.selectOption({ handle: 'target', option: '\u202eMissing\u0001' })).rejects.toThrow(
      '"Missing" is not an option of "target". Available: Alpha',
    );
    root.querySelector('option')!.text = 'x'.repeat(5000);
    await expect(driver.selectOption({ handle: 'target', option: 'y'.repeat(5000) })).rejects.toThrow(
      `"${'y'.repeat(200)}" is not an option of "target". Available: ${'x'.repeat(200)}`,
    );
  });

  it.each([
    '<select data-agent-element="target" disabled><option value="a">Alpha</option><option>Beta</option></select>',
    '<fieldset disabled><select data-agent-element="target"><option value="a">Alpha</option><option>Beta</option></select></fieldset>',
  ])('refuses disabled controls before resolving an unknown option: %s', async (markup) => {
    const driver = mount({ markup });
    await expect(driver.selectOption({ handle: 'target', option: 'Missing' })).rejects.toThrow(
      '"target" is disabled, so its selection cannot be changed — a user cannot change it either, and its value would not be submitted',
    );
    expect(root.querySelector('select')!.value).toBe('a');
  });

  it('refuses a non-dropdown target', async () => {
    const driver = mount({ markup: '<input data-agent-element="target" value="untouched">' });
    await expect(driver.selectOption({ handle: 'target', option: 'Beta' })).rejects.toThrow('"target" is not a dropdown');
    expect(root.querySelector('input')!.value).toBe('untouched');
  });

  it('accumulates and removes multi-select options without changing other choices', async () => {
    const driver = mount({ markup: '<select data-agent-element="target" multiple><option value="a" selected>Alpha</option><option value="b">Beta</option></select>' });
    const select = root.querySelector('select')!;
    await driver.selectOption({ handle: 'target', option: 'Beta' });
    expect(Array.from(select.selectedOptions, (entry) => entry.value)).toEqual(['a', 'b']);
    await driver.selectOption({ handle: 'target', option: 'Alpha' }, { selected: false });
    expect(Array.from(select.selectedOptions, (entry) => entry.value)).toEqual(['b']);
  });

  it('refuses single-select removal after resolving the option and sanitizes its label', async () => {
    const driver = mount({ markup: '<select data-agent-element="target"><option value="a">Alpha</option><option>\u202eBeta</option></select>' });
    const event = vi.fn();
    root.addEventListener('input', event);
    root.addEventListener('change', event);
    await expect(driver.selectOption({ handle: 'target', option: '\u202eBeta' }, { selected: false })).rejects.toThrow(
      '"target" is a single-select; its choice cannot be removed, only replaced — select a different option instead of deselecting "Beta"',
    );
    expect(root.querySelector('select')!.value).toBe('a');
    expect(event).not.toHaveBeenCalled();
  });

  it('selects an option inside a disabled optgroup (reported, not fixed)', async () => {
    const driver = mount({ markup: '<select data-agent-element="target"><option value="a">Alpha</option><optgroup disabled label="Unavailable"><option value="b">Beta</option></optgroup></select>' });
    await driver.selectOption({ handle: 'target', option: 'Beta' });
    expect(root.querySelector('select')!.value).toBe('b');
  });
});
