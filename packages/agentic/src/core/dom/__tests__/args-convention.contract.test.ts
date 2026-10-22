import { expect, it } from 'vitest';
import { getAgentModelContext, createDomPageDriver } from '../index.js';

it('adapts object arguments to native WebMCP while retaining the native receiver', async () => {
  const calls: unknown[] = [];
  const native = {
    async registerTool(tool: unknown, options: unknown) { calls.push([this, tool, options]); },
    unregisterTool(name: string) { calls.push([this, name]); },
  };
  const host = { candidates: () => [null, native] };
  const context = getAgentModelContext({ host })!;
  const tool = { name: 'save', description: 'Save', inputSchema: {}, execute: async () => 'saved' };
  const options = { exposedTo: ['https://example.com'] };
  await context.registerTool({ tool }, options);
  context.unregisterTool!({ name: 'save' });
  expect(calls).toEqual([[native, tool, options], [native, 'save']]);
  expect(getAgentModelContext({ host })).toBe(context);
  expect(getAgentModelContext({ host: { candidates: () => [] } })).toBeUndefined();
});

it('separates required DOM ports, optional page identity and optional selection state', async () => {
  const root = document.createElement('main');
  root.innerHTML = '<select multiple data-agent-element="choices"><option value="one">One</option><option value="two">Two</option></select>';
  const driver = createDomPageDriver({ root, pages: {} }, { currentPage: 'settings' });
  expect((await driver.findElements({}, { query: 'choices' }))[0]?.page).toBe('settings');
  await driver.selectOption({ handle: 'choices', option: 'One' });
  expect(root.querySelector('option')!.selected).toBe(true);
  await driver.selectOption({ handle: 'choices', option: 'One' }, { selected: false });
  expect(root.querySelector('option')!.selected).toBe(false);
});
