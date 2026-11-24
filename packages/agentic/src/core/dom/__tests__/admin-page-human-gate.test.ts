import { expect, it, vi } from 'vitest';
import type { PageDriver, WebMcpToolRegistration } from '../../index.js';
import { registerAdminPageWebMcpTools } from '../admin-page-tools.js';

/** Host approval-table double: reads, edits and navigation run directly; every click needs a card. */
const directPageAction = ({ capabilityId }: { capabilityId: string }) => capabilityId !== 'page.click';

it('sends an opaque click through the authenticated request adapter without exposing an answer tool', async () => {
  const tools: WebMcpToolRegistration[] = [];
  const signal = new AbortController().signal;
  const driver: PageDriver = {
    findElements: async () => [], listPages: async () => [], describeField: async () => ({ type: 'text' }),
    click: vi.fn(), fill: vi.fn(), selectOption: vi.fn(), navigate: vi.fn(), highlight: vi.fn(), scrollTo: vi.fn(),
  };
  const requestPageAction = vi.fn().mockResolvedValue({ clicked: 'delete-confirm' });
  registerAdminPageWebMcpTools({ driver, signal, directPageAction, isEnabled: () => true, onError: vi.fn() }, {
    modelContext: { registerTool: async ({ tool }) => { tools.push(tool as WebMcpToolRegistration); } }, requestPageAction });
  expect(tools.some(tool => tool.name === 'admin.respond_page_approval')).toBe(false);
  await expect(tools.find(tool => tool.name === 'page.click')!.execute({ handle: 'delete-confirm' }))
    .resolves.toEqual({ clicked: 'delete-confirm' });
  expect(requestPageAction).toHaveBeenCalledExactlyOnceWith({ capabilityId: 'page.click', input: { handle: 'delete-confirm' }, signal });
  expect(driver.click).not.toHaveBeenCalled();
});
