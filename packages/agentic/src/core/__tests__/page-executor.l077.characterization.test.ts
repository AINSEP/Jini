import { describe, expect, it, vi } from 'vitest';
import { executePageCapability, projectElementState, MAX_STATEFUL_ELEMENTS } from '../page-executor.js';
import { PAGE_CAPABILITIES } from '../page-capabilities.js';
import type { AgentElementRawState, AgentElementState, AgentElementDescriptor } from '../element-handles.js';
import type { PageDriver } from '../page-driver.js';
import type { FieldDescriptor, FieldRefusal } from '../guards.js';
import { describeFieldRefusal } from '../guards.js';

function fakeDriver(_required: Record<string, never>, overrides: Partial<PageDriver> = {}): PageDriver {
  return {
    findElements: vi.fn(async () => []), listPages: vi.fn(async () => []),
    describeField: vi.fn(async () => ({ type: 'text' })),
    highlight: vi.fn(async () => {}), scrollTo: vi.fn(async () => {}),
    click: vi.fn(async () => {}), fill: vi.fn(async () => {}),
    selectOption: vi.fn(async () => {}), navigate: vi.fn(async () => {}), ...overrides,
  };
}

const missingText = 'this element reported contents without the attributes needed to check them for secrets';
const missingValue = 'this element reported a value without the attributes needed to check it for secrets';
const secret = 'this field type is never readable by an agent';

describe('L077 state projection', () => {
  it.each([
    [{ text: ' a\u202Eb  c ' }, { text: 'a b c', textTruncated: false }],
    [{ text: 'x'.repeat(201) }, { text: 'x'.repeat(200), textTruncated: true }],
    [{ text: 'secret', textIsValue: true }, { text: '', textTruncated: false, textWithheld: missingText }],
    [{ text: 'secret', textIsValue: true, field: { type: 'password' }, checked: true, value: 'secret' },
      { text: '', textTruncated: false, textWithheld: secret, valueWithheld: secret }],
    [{ text: ' label ', field: { type: 'password' }, value: 'secret', options: [' A\u202E ', 'x'.repeat(201)] },
      { text: 'label', textTruncated: false, valueWithheld: secret, options: ['A', 'x'.repeat(200)] }],
    [{ text: ' Editable ', textIsValue: true, field: {}, value: ' value ', checked: false, disabled: false, visible: false },
      { text: 'Editable', textTruncated: false, value: 'value', valueTruncated: false, checked: false, disabled: false, visible: false }],
    [{ text: 'label', value: 'secret' }, { text: 'label', textTruncated: false, valueWithheld: missingValue }],
    [{ text: '', field: {}, value: 'x'.repeat(201), checked: true, disabled: true, visible: true, options: [] },
      { text: '', textTruncated: false, value: 'x'.repeat(200), valueTruncated: true, checked: true, disabled: true, visible: true, options: [] }],
  ] satisfies [AgentElementRawState, AgentElementState][])('projects %j', (raw, expected) => {
    expect(projectElementState({ raw })).toEqual(expected);
  });

  it('reports checked without a field descriptor (reported, not fixed)', () => {
    expect(projectElementState({ raw: { text: '', checked: true } })).toEqual({ text: '', textTruncated: false, checked: true });
  });
});

describe('L077 page dispatch and discovery', () => {
  it('rejects unknown capabilities before calling the driver', async () => {
    const driver = fakeDriver({});
    await expect(executePageCapability({ driver, capabilityId: 'page.unknown', input: {} })).rejects.toThrow('unknown page capability: page.unknown');
    expect(driver.findElements).not.toHaveBeenCalled();
  });

  it('includes the exact schema in input refusals before running a driver', async () => {
    const driver = fakeDriver({});
    const capability = PAGE_CAPABILITIES.find((entry) => entry.id === 'page.fill')!;
    await expect(executePageCapability({ driver, capabilityId: capability.id, input: {} })).rejects.toThrow(
      `page.fill: "handle" is required. Expected input: ${JSON.stringify(capability.inputSchema)}`,
    );
    expect(driver.describeField).not.toHaveBeenCalled();
  });

  it.each([{}, { withState: false }, { withState: true }])('reports discovery without an observing driver for %j', async (input) => {
    const driver = fakeDriver({}, {
      findElements: vi.fn(async () => [{ handle: 'field-one', role: 'field', label: ' Label\u202E ', labelTruncated: true, page: 'home' }]),
      listPages: vi.fn(async () => [{ id: 'home', label: ' Home\u202E ' }]),
    });
    await expect(executePageCapability({ driver, capabilityId: 'page.find_elements', input })).resolves.toEqual({
      elements: [{ handle: 'field-one', role: 'field', label: 'Label', labelTruncated: false, page: 'home' }],
      pages: [{ id: 'home', label: 'Home' }], untrustedFields: ['elements[].label', 'pages[].label'],
      ...(input.withState === true ? { stateUnavailable: true } : {}),
    });
    expect(driver.findElements).toHaveBeenCalledWith({}, {});
  });

  it('forwards role/query filters and bounds observation while leaving all descriptors visible', async () => {
    const found: AgentElementDescriptor[] = Array.from({ length: MAX_STATEFUL_ELEMENTS + 1 }, (_, index) => ({
      handle: `field-${index}`, role: 'field', label: 'Field', labelTruncated: false, page: undefined,
    }));
    const driver = fakeDriver({}, { findElements: vi.fn(async () => found), describeState: vi.fn(async () => ({ text: ' state ' })) });
    const result = await executePageCapability({ driver, capabilityId: 'page.find_elements', input: { role: 'field', query: 'field', withState: true } });
    expect(result).toEqual({
      elements: found.map((element, index) => index < MAX_STATEFUL_ELEMENTS ? { ...element, state: { text: 'state', textTruncated: false } } : element),
      pages: [], untrustedFields: ['elements[].label', 'elements[].state.text', 'elements[].state.value', 'pages[].label'], stateTruncated: true,
    });
    expect(driver.describeState).toHaveBeenCalledTimes(MAX_STATEFUL_ELEMENTS);
    expect(driver.findElements).toHaveBeenCalledWith({}, { role: 'field', query: 'field' });
  });

  it('omits state for unresolved or invalid handles without claiming truncation', async () => {
    const found: AgentElementDescriptor[] = ['valid-handle', '#invalid'].map((handle) => ({ handle, role: undefined, label: '', labelTruncated: false, page: undefined }));
    const driver = fakeDriver({}, { findElements: vi.fn(async () => found), describeState: vi.fn(async () => null) });
    await expect(executePageCapability({ driver, capabilityId: 'page.find_elements', input: { withState: true } })).resolves.toEqual({
      elements: found, pages: [], untrustedFields: ['elements[].label', 'elements[].state.text', 'elements[].state.value', 'pages[].label'],
    });
    expect(driver.describeState).toHaveBeenCalledTimes(1);
  });
});

describe('L077 fill and navigation safety', () => {
  it.each([
    [null, null], [{ type: 'password' }, 'denied-type'], [{ autocomplete: 'cc-number' }, 'denied-autocomplete'],
    [{ name: 'api-key' }, 'suspicious-name'], [{ type: 'checkbox' }, 'not-text'], [{ readOnly: true }, 'read-only'], [{ disabled: true }, 'disabled'],
  ] satisfies [FieldDescriptor | null, FieldRefusal | null][])('refuses fill for %j before observing or writing', async (field, refusal) => {
    const driver = fakeDriver({}, { describeField: vi.fn(async () => field), describeState: vi.fn(async () => ({ text: '' })) });
    await expect(executePageCapability({ driver, capabilityId: 'page.fill', input: { handle: 'field-one', text: 'new' } })).rejects.toThrow(
      refusal === null ? '"field-one" is not a fillable field' : `refusing to fill "field-one": ${describeFieldRefusal({ refusal })}`,
    );
    expect(driver.fill).not.toHaveBeenCalled();
    expect(driver.describeState).not.toHaveBeenCalled();
  });

  it('fills between observations and waits for settling', async () => {
    const calls: string[] = [];
    let value = 'old';
    const driver = fakeDriver({}, {
      describeState: async () => { calls.push('observe'); return { text: '', value, field: {} }; },
      fill: async () => { calls.push('fill'); value = 'new'; },
      settle: async () => { calls.push('settle'); },
    });
    await expect(executePageCapability({ driver, capabilityId: 'page.fill', input: { handle: 'field-one', text: 'new' } })).resolves.toEqual({
      filled: 'field-one', before: { text: '', textTruncated: false, value: 'old', valueTruncated: false },
      after: { text: '', textTruncated: false, value: 'new', valueTruncated: false }, targetChanged: true,
    });
    expect(calls).toEqual(['observe', 'fill', 'settle', 'observe']);
  });

  it.each([false, true])('navigates with settle available=%s and reports both pages', async (settling) => {
    let page = 'home';
    const settle = vi.fn(async () => {});
    const driver = fakeDriver({}, {
      listPages: async () => [{ id: 'next', label: 'Next' }],
      findElements: async () => [{ handle: 'item', role: undefined, label: '', labelTruncated: false, page }],
      navigate: async ({ page: target }) => { page = target; }, ...(settling ? { settle } : {}),
    });
    await expect(executePageCapability({ driver, capabilityId: 'page.navigate', input: { page: 'next' } })).resolves.toEqual({
      navigatedTo: 'next', before: { page: 'home', elementCount: 1 }, after: { page: 'next', elementCount: 1 },
    });
    expect(settle).toHaveBeenCalledTimes(settling ? 1 : 0);
  });

  it.each([[], [{ id: 'home\u202E', label: ' Home\u202E ' }]])('bounds navigation refusals for %j', async (pages) => {
    const driver = fakeDriver({}, { listPages: async () => pages });
    await expect(executePageCapability({ driver, capabilityId: 'page.navigate', input: { page: '\u202E' + 'x'.repeat(201) } })).rejects.toThrow(
      `"${'x'.repeat(200)}" is not a published page. Available: ${pages.length ? 'home (Home)' : '(none)'}`,
    );
    expect(driver.navigate).not.toHaveBeenCalled();
    expect(driver.findElements).not.toHaveBeenCalled();
  });
});

describe('L077 remaining page verbs', () => {
  it.each([
    [undefined, 3_000], [0, 3_000], [-1, 3_000], [NaN, 3_000],
    [Infinity, 3_000], [100, 100], [20_000, 15_000],
  ] satisfies [number | undefined, number][])('clamps highlight duration %s to %s', async (durationMs, duration) => {
    const driver = fakeDriver({});
    await expect(executePageCapability({ driver, capabilityId: 'page.highlight', input: { handle: 'button-one', durationMs } })).resolves.toEqual({ highlighted: 'button-one', durationMs: duration });
    expect(driver.highlight).toHaveBeenCalledWith({ handle: 'button-one', durationMs: duration });
  });

  it.each(['page.highlight', 'page.scroll_to', 'page.click', 'page.fill', 'page.select_option'])('rejects CSS selectors for %s', async (capabilityId) => {
    const driver = fakeDriver({});
    const input = capabilityId === 'page.fill' ? { handle: '#unsafe', text: 'new' }
      : capabilityId === 'page.select_option' ? { handle: '#unsafe', option: 'A' } : { handle: '#unsafe' };
    await expect(executePageCapability({ driver, capabilityId, input })).rejects.toThrow('never a CSS selector');
    expect(driver.highlight).not.toHaveBeenCalled();
    expect(driver.scrollTo).not.toHaveBeenCalled();
    expect(driver.click).not.toHaveBeenCalled();
    expect(driver.describeField).not.toHaveBeenCalled();
    expect(driver.selectOption).not.toHaveBeenCalled();
  });

  it('scrolls to the published handle', async () => {
    const driver = fakeDriver({});
    await expect(executePageCapability({ driver, capabilityId: 'page.scroll_to', input: { handle: 'button-one' } })).resolves.toEqual({ scrolledTo: 'button-one' });
    expect(driver.scrollTo).toHaveBeenCalledWith({ handle: 'button-one' });
  });

  it('clicks without observations when the driver cannot observe', async () => {
    const driver = fakeDriver({});
    await expect(executePageCapability({ driver, capabilityId: 'page.click', input: { handle: 'button-one' } })).resolves.toEqual({ clicked: 'button-one' });
    expect(driver.click).toHaveBeenCalledWith({ handle: 'button-one' });
  });

  it.each([undefined, false, true])('passes select membership %s without a fill guard', async (selected) => {
    const driver = fakeDriver({});
    await expect(executePageCapability({ driver, capabilityId: 'page.select_option', input: { handle: 'field-one', option: 'A', selected } })).resolves.toEqual({
      selected: 'field-one', option: 'A', optionSelected: selected !== false,
    });
    expect(driver.selectOption).toHaveBeenCalledWith({ handle: 'field-one', option: 'A' }, { selected: selected !== false });
    expect(driver.describeField).not.toHaveBeenCalled();
  });
});
