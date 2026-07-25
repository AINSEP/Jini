import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_HIGHLIGHT_MS,
  MAX_HIGHLIGHT_MS,
  executePageCapability,
  type AgentElementDescriptor,
  type FieldDescriptor,
  type PageDriver,
} from '../../agentic/index.js';

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

describe('page.navigate', () => {
  it('navigates to a published page', async () => {
    expect(await executePageCapability(driver, 'page.navigate', { page: 'notes' }))
      .toEqual({ navigatedTo: 'notes' });
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
});
