import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_HIGHLIGHT_MS,
  MAX_AGENT_LABEL_LENGTH,
  MAX_HIGHLIGHT_MS,
  MAX_STATEFUL_ELEMENTS,
  PAGE_CAPABILITIES,
  executePageCapability,
  projectElementState,
  type AgentElementDescriptor,
  type AgentElementRawState,
  type FieldDescriptor,
  type FindElementsResult,
  type PageDriver,
} from '../index.js';

const ELEMENTS: AgentElementDescriptor[] = [
  { handle: 'add-task-button', role: 'button', label: 'Submit the new task', labelTruncated: false, page: 'sunday-list' },
  { handle: 'new-task-input', role: 'field', label: 'Text of the new task', labelTruncated: false, page: 'sunday-list' },
  { handle: 'task-water-plants', role: 'checkbox', label: 'Task: Water the window plants', labelTruncated: false, page: 'sunday-list' },
  { handle: 'account-password', role: 'field', label: 'Account password', labelTruncated: false, page: 'sunday-list' },
];

const FIELDS: Record<string, FieldDescriptor | null> = {
  'new-task-input': { type: 'text', name: 'task' },
  'account-password': { type: 'password', autocomplete: 'current-password', name: 'password' },
  'add-task-button': null,
};

/** A driver that records calls and never touches a DOM — the point of the port. */
function createFakeDriver(overrides: Partial<PageDriver> = {}) {
  const driver: PageDriver = {
    findElements: vi.fn(async (filter) => {
      const query = filter.query?.toLowerCase();
      return ELEMENTS.filter((element) => {
        if (filter.role !== undefined && element.role !== filter.role) return false;
        if (query === undefined) return true;
        return element.handle.toLowerCase().includes(query)
          || element.label.toLowerCase().includes(query);
      });
    }),
    listPages: vi.fn(async () => ['sunday-list', 'notes']),
    describeField: vi.fn(async (handle: string) => FIELDS[handle] ?? null),
    highlight: vi.fn(async () => undefined),
    scrollTo: vi.fn(async () => undefined),
    click: vi.fn(async () => undefined),
    fill: vi.fn(async () => undefined),
    selectOption: vi.fn(async () => undefined),
    navigate: vi.fn(async () => undefined),
    ...overrides,
  };
  return driver;
}

let driver: PageDriver;
beforeEach(() => {
  driver = createFakeDriver();
});

describe('executePageCapability — dispatch', () => {
  it('refuses an id that is not in the manifest', async () => {
    await expect(executePageCapability(driver, 'page.evaluate', {})).rejects.toThrow(
      /unknown page capability: page\.evaluate/,
    );
    // Nothing may reach the page on an unknown id.
    expect(driver.findElements).not.toHaveBeenCalled();
    expect(driver.click).not.toHaveBeenCalled();
  });

  it('refuses a chat capability routed to the page executor', async () => {
    await expect(executePageCapability(driver, 'chat.send_message', { prompt: 'hi' }))
      .rejects.toThrow(/unknown page capability/);
  });
});

describe('executePageCapability — schema enforcement', () => {
  it('rejects unknown arguments rather than silently ignoring them', async () => {
    // The manifests have always advertised additionalProperties:false; nothing enforced it, so a
    // misspelled argument became a missing one with no signal.
    await expect(
      executePageCapability(driver, 'page.highlight', { element: 'add-task-button', bogus: 1 }),
    ).rejects.toThrow(/unknown argument: bogus/);
    expect(driver.highlight).not.toHaveBeenCalled();
  });

  it('lists several unknown arguments, sorted', async () => {
    await expect(
      executePageCapability(driver, 'page.click', { element: 'add-task-button', zeta: 1, alpha: 2 }),
    ).rejects.toThrow(/unknown arguments: alpha, zeta/);
  });

  it('rejects a missing required argument', async () => {
    await expect(executePageCapability(driver, 'page.click', {})).rejects.toThrow(/"element" is required/);
    await expect(executePageCapability(driver, 'page.fill', { element: 'new-task-input' }))
      .rejects.toThrow(/"text" is required/);
  });

  it('embeds the capability\'s input schema in every validation-error message, so a caller can self-correct in the same turn instead of a separate describe_tool round trip', async () => {
    await expect(executePageCapability(driver, 'page.fill', { element: 'new-task-input' }))
      .rejects.toThrow(/Expected input: \{"type":"object".*"required":\["element","text"\]/);
  });

  it('the embedded schema is the exact capability inputSchema, not a hand-summarized approximation', async () => {
    let message = '';
    try {
      await executePageCapability(driver, 'page.click', {});
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    const clickCapability = PAGE_CAPABILITIES.find((c) => c.id === 'page.click')!;
    expect(message).toContain(`Expected input: ${JSON.stringify(clickCapability.inputSchema)}`);
  });

  it('embeds the schema on an unknown-argument refusal too, not only on missing/wrong-type', async () => {
    await expect(
      executePageCapability(driver, 'page.highlight', { element: 'add-task-button', bogus: 1 }),
    ).rejects.toThrow(/Expected input: \{"type":"object"/);
  });

  it('rejects an argument of the wrong type', async () => {
    await expect(executePageCapability(driver, 'page.click', { element: 42 }))
      .rejects.toThrow(/"element" must be a string, received number/);
    await expect(
      executePageCapability(driver, 'page.highlight', { element: 'add-task-button', durationMs: 'soon' }),
    ).rejects.toThrow(/"durationMs" must be a number, received string/);
  });

  it('rejects a value outside a declared enum', async () => {
    await expect(executePageCapability(driver, 'page.find_elements', { role: 'admin' }))
      .rejects.toThrow(/"role" must be one of: button, checkbox/);
  });

  it('prefixes errors with the capability id so a caller knows what failed', async () => {
    await expect(executePageCapability(driver, 'page.click', {})).rejects.toThrow(/^page\.click: /);
  });
});

describe('page.find_elements', () => {
  it('returns every published element with pages and an untrusted-content label', async () => {
    const result = await executePageCapability(driver, 'page.find_elements', {}) as {
      elements: unknown[];
      pages: string[];
      untrustedFields: string[];
    };
    expect(result.elements).toHaveLength(ELEMENTS.length);
    expect(result.pages).toEqual(['sunday-list', 'notes']);
    expect(result.untrustedFields).toContain('elements[].label');
  });

  it('passes a role filter through to the driver', async () => {
    const result = await executePageCapability(driver, 'page.find_elements', { role: 'checkbox' }) as {
      elements: { handle: string }[];
    };
    expect(result.elements.map((element) => element.handle)).toEqual(['task-water-plants']);
    expect(driver.findElements).toHaveBeenCalledWith({ role: 'checkbox' });
  });

  it('passes a query filter through to the driver', async () => {
    const result = await executePageCapability(driver, 'page.find_elements', { query: 'water' }) as {
      elements: { handle: string }[];
    };
    expect(result.elements.map((element) => element.handle)).toEqual(['task-water-plants']);
    expect(driver.findElements).toHaveBeenCalledWith({ query: 'water' });
  });

  it('omits absent filters rather than passing undefined', async () => {
    await executePageCapability(driver, 'page.find_elements', {});
    expect(driver.findElements).toHaveBeenCalledWith({});
  });

  it('normalizes page-authored labels before returning them', async () => {
    const hostile = createFakeDriver({
      findElements: vi.fn(async () => [{
        handle: 'sneaky',
        role: 'button' as const,
        // Control characters and a bidi override, which can make text read differently from
        // how it renders — and it arrives here as if the host had written it.
        label: `Delete\u202Eaccount\u0007  everything   ${'x'.repeat(400)}`,
        labelTruncated: false,
        page: 'sunday-list',
      }]),
    });
    const result = await executePageCapability(hostile, 'page.find_elements', {}) as {
      elements: { label: string; labelTruncated: boolean }[];
    };
    const label = result.elements[0]!;
    expect(label.label).not.toMatch(/[\u0000-\u001F\u202A-\u202E]/);
    expect(label.labelTruncated).toBe(true);
    expect(label.label.length).toBeLessThanOrEqual(200);
  });
});

describe('page.highlight', () => {
  it('applies the default duration when none is given', async () => {
    const result = await executePageCapability(driver, 'page.highlight', { element: 'add-task-button' });
    expect(result).toEqual({ highlighted: 'add-task-button', durationMs: DEFAULT_HIGHLIGHT_MS });
    expect(driver.highlight).toHaveBeenCalledWith('add-task-button', DEFAULT_HIGHLIGHT_MS);
  });

  it('honours a duration within the cap', async () => {
    await executePageCapability(driver, 'page.highlight', { element: 'add-task-button', durationMs: 500 });
    expect(driver.highlight).toHaveBeenCalledWith('add-task-button', 500);
  });

  it('clamps an excessive duration instead of leaving a permanent mark', async () => {
    // highlight is classified `read` precisely because it is transient; an unbounded duration
    // would quietly make it a change of appearance.
    const result = await executePageCapability(driver, 'page.highlight', {
      element: 'add-task-button',
      durationMs: 10_000_000,
    });
    expect(result).toEqual({ highlighted: 'add-task-button', durationMs: MAX_HIGHLIGHT_MS });
  });

  it('falls back to the default for a nonsensical duration', async () => {
    // Infinity and NaN are treated as nonsense rather than as "as long as possible" — a
    // non-finite request is a caller bug, and defaulting is the conservative reading.
    for (const durationMs of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      vi.mocked(driver.highlight).mockClear();
      await executePageCapability(driver, 'page.highlight', { element: 'add-task-button', durationMs });
      const [, applied] = vi.mocked(driver.highlight).mock.calls[0]!;
      expect(applied).toBe(DEFAULT_HIGHLIGHT_MS);
    }
  });
});

describe('page.scroll_to and page.click', () => {
  it('scrolls to a handle', async () => {
    expect(await executePageCapability(driver, 'page.scroll_to', { element: 'add-task-button' }))
      .toEqual({ scrolledTo: 'add-task-button' });
    expect(driver.scrollTo).toHaveBeenCalledWith('add-task-button');
  });

  it('clicks a handle', async () => {
    expect(await executePageCapability(driver, 'page.click', { element: 'add-task-button' }))
      .toEqual({ clicked: 'add-task-button' });
    expect(driver.click).toHaveBeenCalledWith('add-task-button');
  });

  it('propagates a driver failure rather than reporting success', async () => {
    const failing = createFakeDriver({
      click: vi.fn(async () => { throw new Error('no element published as "gone"'); }),
    });
    await expect(executePageCapability(failing, 'page.click', { element: 'gone' }))
      .rejects.toThrow(/no element published as "gone"/);
  });
});

describe('handle validation', () => {
  it('refuses anything that could escape the attribute selector, before touching the page', async () => {
    for (const element of ['a"],script', "a']", 'a b', '*', 'a:hover', 'UPPER', '-leading', 'a\\']) {
      await expect(executePageCapability(driver, 'page.click', { element }))
        .rejects.toThrow(/must be a published element handle/);
    }
    // The refusal is policy, not something a driver is trusted to re-implement.
    expect(driver.click).not.toHaveBeenCalled();
  });

  it('applies to every element-addressed verb', async () => {
    for (const id of ['page.highlight', 'page.scroll_to', 'page.click']) {
      await expect(executePageCapability(driver, id, { element: 'bad selector' }))
        .rejects.toThrow(/must be a published element handle/);
    }
    await expect(executePageCapability(driver, 'page.fill', { element: 'bad selector', text: 'x' }))
      .rejects.toThrow(/must be a published element handle/);
  });
});

describe('page.fill', () => {
  it('fills an ordinary text field', async () => {
    expect(await executePageCapability(driver, 'page.fill', { element: 'new-task-input', text: 'buy milk' }))
      .toEqual({ filled: 'new-task-input' });
    expect(driver.fill).toHaveBeenCalledWith('new-task-input', 'buy milk');
  });

  it('refuses a credential field even though it carries a valid handle', async () => {
    // Tagging a password box does not make it fillable — this is the case a pure allowlist misses.
    await expect(
      executePageCapability(driver, 'page.fill', { element: 'account-password', text: 'hunter2' }),
    ).rejects.toThrow(/refusing to fill "account-password": this field type can never be filled/);
    expect(driver.fill).not.toHaveBeenCalled();
  });

  it('refuses a handle that does not resolve to a field', async () => {
    await expect(executePageCapability(driver, 'page.fill', { element: 'add-task-button', text: 'x' }))
      .rejects.toThrow(/"add-task-button" is not a fillable field/);
    expect(driver.fill).not.toHaveBeenCalled();
  });

  it('asks the page what the field is before writing to it', async () => {
    await executePageCapability(driver, 'page.fill', { element: 'new-task-input', text: 'x' });
    expect(driver.describeField).toHaveBeenCalledWith('new-task-input');
  });

  it('allows an empty string, which is how a field is cleared', async () => {
    await executePageCapability(driver, 'page.fill', { element: 'new-task-input', text: '' });
    expect(driver.fill).toHaveBeenCalledWith('new-task-input', '');
  });
});

describe('page.select_option', () => {
  it('passes the chosen option to the driver and echoes it back, defaulting selected to true', async () => {
    const result = await executePageCapability(driver, 'page.select_option', {
      element: 'new-task-input',
      option: 'Engineer',
    });
    expect(driver.selectOption).toHaveBeenCalledWith('new-task-input', 'Engineer', true);
    expect(result).toMatchObject({ selected: 'new-task-input', option: 'Engineer', optionSelected: true });
  });

  it('passes an explicit selected: false through to the driver and echoes it back', async () => {
    const result = await executePageCapability(driver, 'page.select_option', {
      element: 'new-task-input',
      option: 'Engineer',
      selected: false,
    });
    expect(driver.selectOption).toHaveBeenCalledWith('new-task-input', 'Engineer', false);
    expect(result).toMatchObject({ selected: 'new-task-input', option: 'Engineer', optionSelected: false });
  });

  it('passes an explicit selected: true through the same as the default', async () => {
    await executePageCapability(driver, 'page.select_option', {
      element: 'new-task-input',
      option: 'Engineer',
      selected: true,
    });
    expect(driver.selectOption).toHaveBeenCalledWith('new-task-input', 'Engineer', true);
  });

  it('rejects a non-boolean selected rather than coercing it', async () => {
    await expect(executePageCapability(driver, 'page.select_option', {
      element: 'new-task-input',
      option: 'Engineer',
      selected: 'yes',
    })).rejects.toThrow(/"selected" must be a boolean/);
    expect(driver.selectOption).not.toHaveBeenCalled();
  });

  it('requires both the element and the option', async () => {
    await expect(executePageCapability(driver, 'page.select_option', { element: 'new-task-input' }))
      .rejects.toThrow(/"option" is required/);
    await expect(executePageCapability(driver, 'page.select_option', { option: 'Engineer' }))
      .rejects.toThrow(/"element" is required/);
    expect(driver.selectOption).not.toHaveBeenCalled();
  });

  it('refuses a handle that is not a published one, like every other element-addressed verb', async () => {
    await expect(executePageCapability(driver, 'page.select_option', {
      element: 'select[name=role]',
      option: 'Engineer',
    })).rejects.toThrow(/published element handle/);
    expect(driver.selectOption).not.toHaveBeenCalled();
  });

  it('reports the target before and after, so a caller can confirm what got chosen', async () => {
    const { driver: observing } = createObservingDriver([
      { text: '', value: '', field: { type: 'select', name: 'role' }, options: ['Engineer', 'Designer'] },
      { text: '', value: 'engineer', field: { type: 'select', name: 'role' }, options: ['Engineer', 'Designer'] },
    ]);
    const result = await executePageCapability(observing, 'page.select_option', {
      element: 'new-task-input',
      option: 'Engineer',
    });
    expect(result).toMatchObject({
      selected: 'new-task-input',
      after: { value: 'engineer', options: ['Engineer', 'Designer'] },
      targetChanged: true,
    });
  });
});

describe('page.navigate', () => {
  it('navigates to a published page, reporting what was showing before and after', async () => {
    expect(await executePageCapability(driver, 'page.navigate', { page: 'notes' }))
      .toEqual({
        navigatedTo: 'notes',
        before: { page: 'sunday-list', elementCount: 4 },
        after: { page: 'sunday-list', elementCount: 4 },
      });
    expect(driver.navigate).toHaveBeenCalledWith('notes');
  });

  it('refuses an unpublished page and names what is available', async () => {
    await expect(executePageCapability(driver, 'page.navigate', { page: 'https://example.com' }))
      .rejects.toThrow(/"https:\/\/example\.com" is not a published page\. Available: sunday-list, notes/);
    expect(driver.navigate).not.toHaveBeenCalled();
  });

  it('reports (none) when the host publishes no pages at all', async () => {
    const pageless = createFakeDriver({ listPages: vi.fn(async () => []) });
    await expect(executePageCapability(pageless, 'page.navigate', { page: 'anywhere' }))
      .rejects.toThrow(/Available: \(none\)/);
  });

  it('bounds and strips the caller-supplied page before echoing it back in the refusal', async () => {
    // Regression: the raw `page` argument used to be interpolated straight into the thrown
    // message with no bound and no stripping — a bidi override (U+202E) plus a long run of
    // filler survived verbatim (5000+ chars observed). Every other piece of page-authored text
    // this system hands to a model goes through normalizeAgentLabel; this was the one path
    // that did not.
    const hostile = `‮${'x'.repeat(5000)}​evil-instruction`;
    let caught: Error | undefined;
    try {
      await executePageCapability(driver, 'page.navigate', { page: hostile });
    } catch (error) {
      caught = error as Error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught!.message.length).toBeLessThan(400);
    expect(caught!.message).not.toMatch(/[\x00-\x1f‪-‮​-‏]/);
  });

  it('bounds and strips the pages it advertises as available, not just the caller\'s argument', async () => {
    // `pages` comes straight from the host's own `data-agent-page` attributes — page-authored
    // text with no length bound, the same shape of risk as the caller's `page` argument, in
    // the exact same thrown message.
    const hostilePages = createFakeDriver({
      listPages: vi.fn(async () => [`‮long-page-name-${'y'.repeat(500)}`]),
    });
    let caught: Error | undefined;
    try {
      await executePageCapability(hostilePages, 'page.navigate', { page: 'nope' });
    } catch (error) {
      caught = error as Error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught!.message.length).toBeLessThan(400);
    expect(caught!.message).not.toMatch(/[‪-‮]/);
  });

  it('reports an undefined page when the surface publishes no tagged elements to read one from', async () => {
    const bare = createFakeDriver({ findElements: vi.fn(async () => []) });
    expect(await executePageCapability(bare, 'page.navigate', { page: 'notes' }))
      .toEqual({
        navigatedTo: 'notes',
        before: { page: undefined, elementCount: 0 },
        after: { page: undefined, elementCount: 0 },
      });
  });

  it('waits for the surface to settle before reading the destination', async () => {
    const order: string[] = [];
    const observing = createFakeDriver({
      navigate: vi.fn(async () => { order.push('navigate'); }),
      settle: vi.fn(async () => { order.push('settle'); }),
      findElements: vi.fn(async () => { order.push('read'); return ELEMENTS; }),
    });
    await executePageCapability(observing, 'page.navigate', { page: 'notes' });
    // listPages/allowlist read happens first; what matters is read-navigate-settle-read.
    expect(order).toEqual(['read', 'navigate', 'settle', 'read']);
  });
});

/** State a driver reports for one handle, so the observation tests can vary it per call. */
function createObservingDriver(states: AgentElementRawState[]) {
  const queue = [...states];
  const describeState = vi.fn(async () => queue.shift() ?? null);
  return { driver: createFakeDriver({ describeState, settle: vi.fn(async () => undefined) }), describeState };
}

const UNCHECKED: AgentElementRawState = { text: 'Water the window plants', checked: false, visible: true };
const CHECKED: AgentElementRawState = { text: 'Water the window plants', checked: true, visible: true };

describe('write observation — the caller can check its own work', () => {
  it('reports the target before and after a click, and that it changed', async () => {
    const { driver: observing } = createObservingDriver([UNCHECKED, CHECKED]);
    expect(await executePageCapability(observing, 'page.click', { element: 'task-water-plants' }))
      .toEqual({
        clicked: 'task-water-plants',
        before: { text: 'Water the window plants', textTruncated: false, checked: false, visible: true },
        after: { text: 'Water the window plants', textTruncated: false, checked: true, visible: true },
        targetChanged: true,
      });
  });

  it('reports targetChanged false when the click left its own target exactly as it was', async () => {
    const { driver: observing } = createObservingDriver([UNCHECKED, UNCHECKED]);
    const result = await executePageCapability(observing, 'page.click', { element: 'task-water-plants' });
    expect(result).toMatchObject({ targetChanged: false });
  });

  it('reads state, acts, settles, then reads again — in that order', async () => {
    const order: string[] = [];
    const observing = createFakeDriver({
      describeState: vi.fn(async () => { order.push('read'); return UNCHECKED; }),
      click: vi.fn(async () => { order.push('click'); }),
      settle: vi.fn(async () => { order.push('settle'); }),
    });
    await executePageCapability(observing, 'page.click', { element: 'task-water-plants' });
    expect(order).toEqual(['read', 'click', 'settle', 'read']);
  });

  it('omits the after reading, and any verdict, when the click removed its own target', async () => {
    const { driver: observing } = createObservingDriver([UNCHECKED]);
    const result = await executePageCapability(observing, 'page.click', { element: 'task-water-plants' });
    expect(result).toEqual({
      clicked: 'task-water-plants',
      before: { text: 'Water the window plants', textTruncated: false, checked: false, visible: true },
    });
  });

  it('adds nothing at all for a driver that cannot observe itself', async () => {
    expect(await executePageCapability(driver, 'page.click', { element: 'task-water-plants' }))
      .toEqual({ clicked: 'task-water-plants' });
  });

  it('reports what a filled field now holds', async () => {
    const { driver: observing } = createObservingDriver([
      { text: '', value: '', field: { type: 'text', name: 'task' } },
      { text: '', value: 'Ada Lovelace', field: { type: 'text', name: 'task' } },
    ]);
    const result = await executePageCapability(observing, 'page.fill', { element: 'new-task-input', text: 'Ada Lovelace' });
    expect(result).toMatchObject({
      filled: 'new-task-input',
      after: { value: 'Ada Lovelace', valueTruncated: false },
      targetChanged: true,
    });
  });

  it('still refuses a guarded field before observing anything', async () => {
    const { driver: observing, describeState } = createObservingDriver([UNCHECKED, UNCHECKED]);
    await expect(executePageCapability(observing, 'page.fill', { element: 'account-password', text: 'hunter2' }))
      .rejects.toThrow(/refusing to fill "account-password"/);
    expect(describeState).not.toHaveBeenCalled();
  });
});

describe('projectElementState — what a caller may see', () => {
  it('normalizes and bounds page-authored text', () => {
    expect(projectElementState({ text: '  Water   the‮ plants  ' }))
      .toEqual({ text: 'Water the plants', textTruncated: false });
    expect(projectElementState({ text: 'x'.repeat(MAX_AGENT_LABEL_LENGTH + 10) }).textTruncated).toBe(true);
  });

  it('reports the value of an ordinary field', () => {
    expect(projectElementState({ text: '', value: 'Ada', field: { type: 'text', name: 'full-name' } }))
      .toMatchObject({ value: 'Ada', valueTruncated: false });
  });

  it('reports the value of a read-only field, which is not a secrecy question', () => {
    expect(projectElementState({ text: '', value: 'ACME Inc', field: { type: 'text', name: 'org', readOnly: true } }))
      .toMatchObject({ value: 'ACME Inc' });
  });

  it('reports the value of a disabled field for the same reason', () => {
    expect(projectElementState({ text: '', value: 'ACME Inc', field: { type: 'text', name: 'org', disabled: true } }))
      .toMatchObject({ value: 'ACME Inc' });
  });

  it.each([
    ['a password box', { type: 'password', name: 'password' }, 'this field type is never readable by an agent'],
    ['a hidden anti-forgery field', { type: 'hidden', name: 'csrf_token' }, 'this field type is never readable by an agent'],
    ['a card number', { type: 'text', autocomplete: 'cc-number', name: 'card' }, 'this field holds a credential or payment instrument'],
    ['a secret-looking name', { type: 'text', name: 'api_key' }, 'this field name indicates a secret or anti-forgery token'],
  ])('withholds the value of %s, and says so rather than reporting it empty', (_label, field, reason) => {
    const state = projectElementState({ text: '', value: 'super-secret', field });
    expect(state.value).toBeUndefined();
    expect(state.valueWithheld).toBe(reason);
  });

  it('withholds a value that arrived with no attributes to check it against', () => {
    const state = projectElementState({ text: '', value: 'unknown provenance' });
    expect(state.value).toBeUndefined();
    expect(state.valueWithheld).toMatch(/without the attributes needed to check it for secrets/);
  });

  it('reports a dropdown\'s options, bounded but never withheld', () => {
    // Which options exist is the page's own ontology — a caller needs it to pass a valid one to
    // page.select_option, and it reveals nothing about the user.
    const state = projectElementState({
      text: '',
      value: 'secret',
      field: { type: 'select', name: 'auth_token' },
      options: ['  Engineer  ', 'Designer'],
    });
    expect(state.options).toEqual(['Engineer', 'Designer']);
    // ...while the selected value of a secret-named dropdown is still withheld.
    expect(state.value).toBeUndefined();
    expect(state.valueWithheld).toBeDefined();
  });

  it('passes checked, disabled and visible through when the driver reported them', () => {
    expect(projectElementState({ text: 'Submit', checked: false, disabled: true, visible: false }))
      .toEqual({ text: 'Submit', textTruncated: false, checked: false, disabled: true, visible: false });
  });

  it('withholds checked, not just value, on a refused checkbox/radio field', () => {
    // Regression: checked used to be spread into the result unconditionally, three lines above
    // the refusal check, so a checkbox whose name triggered the guard still reported its boolean
    // state even though `value` was withheld on the same descriptor.
    const state = projectElementState({
      text: '',
      value: 'on',
      checked: true,
      field: { type: 'checkbox', name: 'otp_verified' },
    });
    expect(state.checked).toBeUndefined();
    expect(state.valueWithheld).toBe('this field name indicates a secret or anti-forgery token');
  });

  it('withholds checked on a radio group named for a credential even though the option label is plain', () => {
    const state = projectElementState({
      text: 'I am HIV positive',
      value: 'hiv-positive',
      checked: true,
      field: { type: 'radio', name: 'health_disclosure_password' },
    });
    expect(state.checked).toBeUndefined();
    expect(state.valueWithheld).toBeDefined();
    // The option's own visible label is page ontology, not the user's data — unlike `checked`,
    // it must NOT be withheld. Blinding a caller to it would lose the "what is this option"
    // information for no reduction in what actually leaks (which option is chosen).
    expect(state.text).toBe('I am HIV positive');
  });

  it('still reports checked on an unrefused checkbox — the gate is the refusal, not the shape', () => {
    const state = projectElementState({
      text: 'Water the plants',
      value: 'on',
      checked: true,
      field: { type: 'checkbox', name: 'task-water-plants' },
    });
    expect(state.checked).toBe(true);
  });

  it('omits checked, disabled and visible rather than inventing false for them', () => {
    expect(projectElementState({ text: 'Heading' })).toEqual({ text: 'Heading', textTruncated: false });
  });
});

describe('page.find_elements — withState', () => {
  it('reports no state at all by default', async () => {
    const { driver: observing, describeState } = createObservingDriver([]);
    const result = await executePageCapability(observing, 'page.find_elements', {}) as FindElementsResult;
    expect(result.elements.every((element) => element.state === undefined)).toBe(true);
    expect(describeState).not.toHaveBeenCalled();
  });

  it('attaches state to each element when asked', async () => {
    const observing = createFakeDriver({
      describeState: vi.fn(async (handle: string) => ({ text: `state of ${handle}`, visible: true })),
    });
    const result = await executePageCapability(observing, 'page.find_elements', { withState: true }) as FindElementsResult;
    expect(result.elements[0]?.state).toEqual({
      text: 'state of add-task-button',
      textTruncated: false,
      visible: true,
    });
    expect(result.untrustedFields).toContain('elements[].state.value');
  });

  it('never reports a password field\'s contents, even in a bulk listing', async () => {
    const observing = createFakeDriver({
      describeState: vi.fn(async (handle: string) => ({
        text: '',
        value: 'hunter2',
        field: FIELDS[handle] ?? undefined,
      })),
    });
    const result = await executePageCapability(observing, 'page.find_elements', { withState: true }) as FindElementsResult;
    const password = result.elements.find((element) => element.handle === 'account-password');
    expect(password?.state?.value).toBeUndefined();
    expect(password?.state?.valueWithheld).toBe('this field type is never readable by an agent');
  });

  it('says so plainly when the surface cannot observe itself', async () => {
    const result = await executePageCapability(driver, 'page.find_elements', { withState: true }) as FindElementsResult;
    expect(result.stateUnavailable).toBe(true);
    expect(result.elements.every((element) => element.state === undefined)).toBe(true);
    expect(result.untrustedFields).toEqual(['elements[].label']);
  });

  it('caps how many elements it will describe, and reports the cap rather than silently stopping', async () => {
    const many: AgentElementDescriptor[] = Array.from({ length: MAX_STATEFUL_ELEMENTS + 3 }, (_unused, index) => ({
      handle: `row-${index}`, role: 'status' as const, label: `Row ${index}`, labelTruncated: false, page: 'sunday-list',
    }));
    const observing = createFakeDriver({
      findElements: vi.fn(async () => many),
      describeState: vi.fn(async () => ({ text: 'row' })),
    });
    const result = await executePageCapability(observing, 'page.find_elements', { withState: true }) as FindElementsResult;
    expect(result.stateTruncated).toBe(true);
    expect(result.elements[MAX_STATEFUL_ELEMENTS - 1]?.state).toBeDefined();
    expect(result.elements[MAX_STATEFUL_ELEMENTS]?.state).toBeUndefined();
    expect(observing.describeState).toHaveBeenCalledTimes(MAX_STATEFUL_ELEMENTS);
  });

  it('does not set stateTruncated when everything matched fits under the cap', async () => {
    const observing = createFakeDriver({ describeState: vi.fn(async () => ({ text: 'x' })) });
    const result = await executePageCapability(observing, 'page.find_elements', { withState: true }) as FindElementsResult;
    expect(result.stateTruncated).toBeUndefined();
  });

  it('skips state for an element the page published under an unusable handle, rather than failing the listing', async () => {
    const observing = createFakeDriver({
      findElements: vi.fn(async () => [
        { handle: 'Not A Handle', role: undefined, label: 'Malformed', labelTruncated: false, page: 'sunday-list' },
      ]),
      describeState: vi.fn(async () => ({ text: 'never reached' })),
    });
    const result = await executePageCapability(observing, 'page.find_elements', { withState: true }) as FindElementsResult;
    expect(result.elements[0]?.state).toBeUndefined();
    expect(observing.describeState).not.toHaveBeenCalled();
  });

  it('rejects a non-boolean withState through the shared schema check', async () => {
    await expect(executePageCapability(driver, 'page.find_elements', { withState: 'yes' }))
      .rejects.toThrow(/"withState" must be a boolean, received string/);
  });
});
