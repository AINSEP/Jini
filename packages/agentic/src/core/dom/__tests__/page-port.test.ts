import { describe, expect, it, vi } from 'vitest';
import type { PageDriver } from '../../page-driver.js';
import { createDriverPagePort } from '../page-port.js';

/**
 * @file `createDriverPagePort` through the real executor: which driver method each page capability
 * reaches, and the ids the port serves. Chat's own tests drive its bridge with a fake of its port
 * (`ChatPagePort`), so this is where "the real port reaches the real driver method" is held
 * (C-CHAT-DEPS S6-a). Characterization of existing behaviour.
 */

function createDriver(overrides: Partial<PageDriver> = {}): PageDriver {
  return {
    findElements: vi.fn(async () => [
      { handle: 'save-button', role: 'button' as const, label: 'Save', labelTruncated: false, page: 'home' },
    ]),
    listPages: vi.fn(async () => [{ id: 'home', label: 'Home' }]),
    selectOption: vi.fn(async () => undefined),
    describeField: vi.fn(async () => ({ type: 'text' })),
    highlight: vi.fn(async () => undefined),
    scrollTo: vi.fn(async () => undefined),
    click: vi.fn(async () => undefined),
    fill: vi.fn(async () => undefined),
    navigate: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('createDriverPagePort', () => {
  it('serves exactly the seven page capability ids', () => {
    expect(createDriverPagePort({ driver: createDriver() }).capabilityIds).toEqual([
      'page.find_elements', 'page.highlight', 'page.scroll_to', 'page.click', 'page.fill', 'page.select_option', 'page.navigate',
    ]);
  });

  it('page.click reaches driver.click and answers with the clicked handle', async () => {
    const driver = createDriver();
    const result = await createDriverPagePort({ driver }).execute({ capabilityId: 'page.click', input: { handle: 'save-button' } });
    expect(driver.click).toHaveBeenCalledWith({ handle: 'save-button' });
    expect(result).toMatchObject({ clicked: 'save-button' });
  });

  it('page.fill reaches driver.fill with the text', async () => {
    const driver = createDriver();
    const result = await createDriverPagePort({ driver }).execute({ capabilityId: 'page.fill', input: { handle: 'name-input', text: 'Ada' } });
    expect(driver.fill).toHaveBeenCalledWith({ handle: 'name-input', text: 'Ada' });
    expect(result).toMatchObject({ filled: 'name-input' });
  });

  it('page.navigate reaches driver.navigate for a published page', async () => {
    const driver = createDriver();
    const result = await createDriverPagePort({ driver }).execute({ capabilityId: 'page.navigate', input: { page: 'home' } });
    expect(driver.navigate).toHaveBeenCalledWith({ page: 'home' });
    expect(result).toMatchObject({ navigatedTo: 'home' });
  });

  it('page.find_elements reaches driver.findElements, defaulting a missing input to no filter', async () => {
    const driver = createDriver();
    const result = await createDriverPagePort({ driver }).execute({ capabilityId: 'page.find_elements', input: {} });
    expect(driver.findElements).toHaveBeenCalledWith({}, {});
    expect(result).toMatchObject({ elements: [expect.objectContaining({ handle: 'save-button' })] });
  });

  it('page.select_option reaches driver.selectOption with the option and its selected flag', async () => {
    const driver = createDriver();
    const result = await createDriverPagePort({ driver }).execute({ capabilityId: 'page.select_option', input: { handle: 'plan-select', option: 'Pro' } });
    expect(driver.selectOption).toHaveBeenCalledWith({ handle: 'plan-select', option: 'Pro' }, { selected: true });
    expect(result).toMatchObject({ selected: 'plan-select', option: 'Pro', optionSelected: true });
  });

  it('page.scroll_to reaches driver.scrollTo', async () => {
    const driver = createDriver();
    const result = await createDriverPagePort({ driver }).execute({ capabilityId: 'page.scroll_to', input: { handle: 'save-button' } });
    expect(driver.scrollTo).toHaveBeenCalledWith({ handle: 'save-button' });
    expect(result).toEqual({ scrolledTo: 'save-button' });
  });

  it('page.highlight reaches driver.highlight with a duration', async () => {
    const driver = createDriver();
    const result = await createDriverPagePort({ driver }).execute({ capabilityId: 'page.highlight', input: { handle: 'save-button', durationMs: 500 } });
    expect(driver.highlight).toHaveBeenCalledWith({ handle: 'save-button', durationMs: 500 });
    expect(result).toMatchObject({ highlighted: 'save-button', durationMs: 500 });
  });

  it('page.fill asks driver.describeField first and refuses a field the page does not describe', async () => {
    const driver = createDriver({ describeField: vi.fn(async () => null) });
    await expect(createDriverPagePort({ driver }).execute({ capabilityId: 'page.fill', input: { handle: 'name-input', text: 'Ada' } }))
      .rejects.toThrow('"name-input" is not a fillable field');
    expect(driver.describeField).toHaveBeenCalledWith({ handle: 'name-input' });
    expect(driver.fill).not.toHaveBeenCalled();
  });

  it('refuses an input that fails the capability schema before any driver method runs', async () => {
    const driver = createDriver();
    await expect(createDriverPagePort({ driver }).execute({ capabilityId: 'page.click', input: {} })).rejects.toThrow('page.click: "handle" is required');
    expect(driver.click).not.toHaveBeenCalled();
  });
});
