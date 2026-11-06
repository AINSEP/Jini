import { useState } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createDomPageDriver } from '@jini-ai/agentic/dom';
import type { AgentAttrsPort } from '@jini-ai/ui-kit';
import { Button, Dialog, KitProvider, Menu, Tabs } from '@jini-ai/ui-kit/react';
import { CustomSelect } from '../../components/CustomSelect.js';
import { PillButton } from '../../components/PillButton.js';
import { TabStrip } from '../../../features/tab-strip/react/components/TabStrip.js';

const roots: HTMLElement[] = [];
afterEach(() => { cleanup(); for (const root of roots.splice(0)) root.remove(); });
function scope() {
  const root = document.createElement('main');
  const mount = document.createElement('div');
  const overlay = document.createElement('div');
  root.append(mount, overlay); document.body.append(root); roots.push(root);
  return { root, mount, overlay, driver: createDomPageDriver({ root, pages: {} }) };
}
const agent: AgentAttrsPort = ({ handle }, optional) => ({
  'data-agent-element': handle, 'data-agent-role': optional?.role,
  'data-agent-label': optional?.label, 'data-agent-page': 'profile',
});

it('drives kit tabs, portalled menu items and dialog close inside the host root', async () => {
  const { root, mount, overlay, driver } = scope();
  const opened = vi.fn(), closed = vi.fn();
  // jsdom has no native top layer; the equivalent authored ARIA modal exercises live blocking.
  const modalAttrs = { role: 'dialog', 'aria-modal': 'true' };
  function Surface() {
    const [tab, setTab] = useState('one'), [open, setOpen] = useState(false);
    return <KitProvider overlayContainer={overlay} agent={agent}>
      <Tabs agentHandle="settings" label="Settings" value={tab} onValueChange={({ value }) => setTab(value)}
        items={[{ id: 'one', label: 'First', content: <Button>First panel action</Button> }, { id: 'two', label: 'Second', content: <Button>Second panel action</Button> }]} />
      <Menu agentHandle="actions" label="Actions" items={[{ id: 'open', label: 'Open details', onPress: () => { opened(); setOpen(true); } }]} />
      <Dialog agentHandle="details" attrs={modalAttrs} open={open} title="Details" onClose={() => { closed(); setOpen(false); }}>Dialog content</Dialog>
    </KitProvider>;
  }
  render(<Surface />, { container: mount });
  expect((await driver.findElements({}, {})).some(item => item.label === 'Second panel action')).toBe(false);
  await act(async () => driver.click({ handle: 'settings-two' }));
  expect(screen.getByRole('tab', { name: 'Second' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tabpanel')).toHaveTextContent('Second panel action');
  const panelControl = screen.getByRole('button', { name: 'Second panel action' });
  expect(panelControl).toHaveAttribute('data-agent-element');
  expect((await driver.findElements({}, {})).some(item => item.handle === panelControl.getAttribute('data-agent-element'))).toBe(true);
  expect((await driver.findElements({}, {})).some(item => item.label === 'First panel action')).toBe(false);
  await act(async () => driver.click({ handle: 'actions' }));
  const row = screen.getByRole('menuitem', { name: 'Open details' });
  expect(overlay.contains(row)).toBe(true);
  expect((await driver.findElements({}, {})).find(item => item.handle === 'actions-open')?.page).toBe('profile');
  await act(async () => driver.click({ handle: 'actions-open' }));
  expect(opened).toHaveBeenCalledOnce();
  const dialog = screen.getByRole('dialog', { name: 'Details' });
  expect(root.contains(dialog)).toBe(true);
  expect(overlay.contains(dialog)).toBe(true);
  await expect(driver.click({ handle: 'settings-one' })).rejects.toThrow('active modal');
  expect(screen.getByRole('tab', { name: 'Second' })).toHaveAttribute('aria-selected', 'true');
  await act(async () => driver.click({ handle: 'details-close' }));
  expect(closed).toHaveBeenCalledOnce();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('keeps select options in a supplied overlay and preserves their page identity', async () => {
  const { mount, overlay, driver } = scope();
  const onChange = vi.fn();
  render(<CustomSelect agentHandle="choose" data-agent-page="profile" portalContainer={overlay}
    value="a" options={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]} onChange={onChange} ariaLabel="Kind" />, { container: mount });
  await act(async () => driver.click({ handle: 'choose' }));
  expect(overlay.contains(screen.getByRole('option', { name: 'B' }))).toBe(true);
  expect((await driver.findElements({}, {})).find(item => item.handle === 'choose-option-b')?.page).toBe('profile');
  await act(async () => driver.click({ handle: 'choose-option-b' }));
  expect(onChange).toHaveBeenCalledWith('b');
});

it('activates and closes tabs by id without routing close through the tab action', async () => {
  const { mount, driver } = scope();
  const onActivate = vi.fn(), onClose = vi.fn();
  render(<TabStrip agentHandle="workspace" activeTabId="one" tabs={[{ id: 'one', content: 'One' }, { id: 'two', content: 'Two' }]}
    onActivate={onActivate} onClose={onClose} onReorder={vi.fn()} />, { container: mount });
  await act(async () => driver.click({ handle: 'workspace-tab-two' }));
  expect(onActivate.mock.calls).toEqual([['two']]);
  await act(async () => driver.click({ handle: 'workspace-tab-two-close' }));
  expect(onClose.mock.calls).toEqual([['two']]);
  expect(onActivate).toHaveBeenCalledTimes(1);
});

it('refuses duplicate explicit addresses and excludes inactive controls from discovery', async () => {
  const { mount, driver } = scope();
  const clicked = vi.fn(), warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  render(<><PillButton label="First" onClick={clicked} agentHandle="duplicate" /><PillButton label="Second" onClick={clicked} agentHandle="duplicate" />
    <div hidden><PillButton label="Inactive" onClick={clicked} agentHandle="inactive" /></div></>, { container: mount });
  await expect(driver.click({ handle: 'duplicate' })).rejects.toThrow('ambiguous');
  expect(warning).toHaveBeenCalled();
  expect(clicked).not.toHaveBeenCalled();
  expect((await driver.findElements({}, {})).some(item => item.handle === 'inactive')).toBe(false);
  warning.mockRestore();
});

it.each(['custom', 'widget', 'shadcn'] as const)('inherits the kit overlay for the %s select and retains origin page identity', async (kind) => {
  const { mount, overlay, driver } = scope();
  const onChange = vi.fn();
  const props = { agentHandle: 'choose', value: 'a', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], onChange };
  const { Select: WidgetSelect } = await import('../../../features/admin-widgets/components/Select/Select.js');
  const { SelectField } = await import('../../../features/interactive-ui/providers/shadcn/select-field.js');
  render(<section data-agent-page="profile"><KitProvider overlayContainer={overlay}>
    {kind === 'custom' ? <CustomSelect {...props} ariaLabel="Kind" /> : kind === 'widget' ? <WidgetSelect {...props} aria-label="Kind" /> : <SelectField agentHandle="choose" value="a" options={props.options} onValueChange={onChange} />}
  </KitProvider></section>, { container: mount });
  await act(async () => driver.click({ handle: 'choose' }));
  const row = screen.getByRole('option', { name: 'B' });
  expect(overlay.contains(row)).toBe(true);
  const handle = row.getAttribute('data-agent-element')!;
  expect((await driver.findElements({}, {})).find(item => item.handle === handle)?.page).toBe('profile');
  await act(async () => driver.click({ handle }));
  expect(onChange.mock.calls).toEqual([['b']]);
});
