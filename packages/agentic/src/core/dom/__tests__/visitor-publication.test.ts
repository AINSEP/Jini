import { afterEach, expect, it, vi } from 'vitest';
import { createDomPageDriver } from '../dom-page-driver.js';
const roots: HTMLElement[] = [];
function setup(markup: string) {
  const root = document.createElement('main'); root.innerHTML = markup; root.dataset.agentPublication = 'rev'; document.body.append(root); roots.push(root);
  const publication = { revision: 'rev', elements: [
    { handle: 'panel', action: 'read' as const }, { handle: 'toggle', action: 'menu' as const },
    { handle: 'secret', action: 'fill' as const }, { handle: 'submit', action: 'submit' as const },
  ] };
  return { root, driver: createDomPageDriver({ root, pages: {} }, { publication }) };
}
afterEach(() => roots.splice(0).forEach(root => root.remove()));
it('publication hides unmarked, duplicate, private, hidden and credential handles on every read', async () => {
  const { driver } = setup('<section data-agent-element="panel">Public<span hidden>Hidden</span><span style="display:none">CSS secret</span><span data-agent-private>Private</span><input value="secret" type="password"></section><button data-agent-element="toggle">One</button><button data-agent-element="toggle">Two</button><input data-agent-element="secret" type="password" value="hunter2"><p data-agent-element="unmarked">Unmarked</p>');
  expect((await driver.findElements({})).map(e => e.handle)).toEqual(['panel']);
  const state = await driver.describeState!({ handle: 'panel' });
  expect(state?.text).toBe('Public');
  expect(await driver.describeState!({ handle: 'secret' })).toBeNull();
  await expect(driver.click({ handle: 'toggle' })).rejects.toThrow();
  await expect(driver.fill({ handle: 'secret', text: 'x' })).rejects.toThrow();
});
it('rechecks identity, visibility, action class and publication revision before effects', async () => {
  const { root, driver } = setup('<button type="button" data-agent-element="toggle">Menu</button><section data-agent-element="panel">Content</section>');
  const clicked = vi.fn(); root.firstElementChild!.addEventListener('click', clicked);
  await driver.click({ handle: 'toggle' }); expect(clicked).toHaveBeenCalledTimes(1);
  await expect(driver.click({ handle: 'panel' })).rejects.toThrow();
  root.firstElementChild!.setAttribute('hidden', '');
  await expect(driver.click({ handle: 'toggle' })).rejects.toThrow();
  root.firstElementChild!.removeAttribute('hidden');
  root.firstElementChild!.replaceWith(root.firstElementChild!.cloneNode(true));
  await expect(driver.click({ handle: 'toggle' })).rejects.toThrow();
  root.dataset.agentPublication = 'new';
  expect(await driver.findElements({})).toEqual([]);
});
it('never follows links through click, and rejects a submitter whose form target changed', async () => {
  const { root, driver } = setup('<a href="/admin" data-agent-element="toggle">Link</a><form action="/contact"><button data-agent-element="submit">Send</button></form>');
  await expect(driver.click({ handle: 'toggle' })).rejects.toThrow();
  root.querySelector('form')!.action = '/admin';
  await expect(driver.click({ handle: 'submit' })).rejects.toThrow();
});
it('cancellation during observation prevents the later effect', async () => {
  const { root, driver } = setup('<button type="button" data-agent-element="toggle">Menu</button>');
  const { executePageCapability } = await import('../../page-executor.js');
  const effect = vi.fn(); root.firstElementChild!.addEventListener('click', effect);
  await executePageCapability({ driver, capabilityId: 'page.click', input: { handle: 'toggle' } });
  expect(effect).toHaveBeenCalledTimes(1);
  const controller = new AbortController();
  const click = vi.fn(driver.click.bind(driver));
  const describe = driver.describeState!.bind(driver);
  const observed = vi.fn(async (...args: Parameters<typeof describe>) => {
    const result = await describe(...args); controller.abort(); return result;
  });
  const guarded = { ...driver, click, describeState: observed };
  await expect(executePageCapability({ driver: guarded, capabilityId: 'page.click', input: { handle: 'toggle' } }, { signal: controller.signal })).rejects.toThrow();
  expect(observed).toHaveBeenCalledTimes(1);
  expect(controller.signal.aborted).toBe(true);
  expect(click).not.toHaveBeenCalled();
  expect(effect).toHaveBeenCalledTimes(1);
});
it('native submit can acknowledge acceptance before its effect, and rechecks the target afterwards', async () => {
  const root = document.createElement('main'); root.dataset.agentPublication = 'rev';
  root.innerHTML = '<form action="/contact"><button type="submit" data-agent-element="send">Send</button></form>';
  document.body.append(root); roots.push(root);
  let effect: (() => Promise<void>) | undefined;
  let submitted = 0;
  root.querySelector('form')!.addEventListener('submit', event => { event.preventDefault(); submitted++; });
  const driver = createDomPageDriver({ root, pages: {} }, { publication: { revision: 'rev', elements: [
    { handle: 'send', action: 'submit', target: { action: '/contact', method: 'get' } },
  ] }, deferSubmit: ({ execute }) => { effect = execute; } });
  await driver.click({ handle: 'send' });
  expect(submitted).toBe(0); expect(effect).toBeTypeOf('function');
  root.querySelector('form')!.action = '/admin';
  await expect(effect!()).rejects.toThrow(); expect(submitted).toBe(0);
});
it('published submitters cannot submit unmarked credential or payment controls', async () => {
  for (const field of ['<input type="password" name="password">', '<input autocomplete="cc-number" name="number">']) {
    const root = document.createElement('main'); root.dataset.agentPublication = 'rev';
    root.innerHTML = `<form action="/contact">${field}<button type="submit" data-agent-element="send">Send</button></form>`;
    document.body.append(root); roots.push(root);
    const submit = vi.fn((event: Event) => event.preventDefault()); root.querySelector('form')!.addEventListener('submit', submit);
    const driver = createDomPageDriver({ root, pages: {} }, { publication: { revision: 'rev', elements: [
      { handle: 'send', action: 'submit', target: { action: '/contact', method: 'get' } },
    ] } });
    await expect(driver.click({ handle: 'send' })).rejects.toThrow(); expect(submit).not.toHaveBeenCalled();
  }
});
it('payment autocomplete protects dropdown reads and selection as well as text fields', async () => {
  const root = document.createElement('main'); root.dataset.agentPublication = 'rev';
  root.innerHTML = '<select data-agent-element="expiry" autocomplete="cc-exp-month"><option>January</option></select>';
  document.body.append(root); roots.push(root);
  const driver = createDomPageDriver({ root, pages: {} }, { publication: { revision: 'rev', elements: [{ handle: 'expiry', action: 'select' }] } });
  expect(await driver.findElements({})).toEqual([]);
  expect(await driver.describeState!({ handle: 'expiry' })).toBeNull();
  await expect(driver.selectOption({ handle: 'expiry', option: 'January' })).rejects.toThrow();
});
