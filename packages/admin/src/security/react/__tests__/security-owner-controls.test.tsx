import { TestChipField } from './chip-field.fixture.js';
import { Suspense, useEffect, type ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, fireEvent, cleanup } from '../../../__tests__/fetch-query-support.js';
import { reactModuleUi } from '../../../core/react/module-ui.js';
import { createAdmin } from '../../../core/module/index.js';
import { createMemorySecurityApi, createMemoryRootKey } from '../../adapters/memory.js';
import { security } from '../index.js';

// SEC-2 (P9-SEC plan v2): the host fills one owner-controls slot (its TOTP, recovery and passkey
// settings). The module renders it once above the TabBar, only when the page is visible, and a tab
// change never remounts it.
afterEach(cleanup);
let mounts = 0;
function OwnerControls() {
  useEffect(() => { mounts += 1; }, []);
  return <div data-testid="owner-controls">owner settings</div>;
}
function mount(permissions: readonly string[], ownerControls?: ReactNode) {
  mounts = 0;
  const feature = security({ ui: reactModuleUi, ChipField: TestChipField });
  const admin = createAdmin({ modules: [feature], ports: { securityApi: createMemorySecurityApi({}), rootKey: createMemoryRootKey({}) } }, { permissions });
  const { Page, tabs } = feature.react.pages.secrets;
  return render(<feature.react.Provider admin={admin} {...(ownerControls === undefined ? {} : { ownerControls })}><Suspense fallback="Loading"><Page tabs={tabs} description={admin.describe().pages[0]!} /></Suspense></feature.react.Provider>);
}
const GRANTED = ['security.read', 'admin.security.tokens.manage'];

describe('SEC-2 owner-controls slot', () => {
  it('renders the slot once, before the TabBar', async () => {
    mount(GRANTED, <OwnerControls />);
    const tablist = await screen.findByRole('tablist');
    const slots = screen.getAllByTestId('owner-controls');
    expect(slots).toHaveLength(1);
    expect(slots[0]!.compareDocumentPosition(tablist) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders no slot when the page is denied', async () => {
    mount([], <OwnerControls />);
    expect(await screen.findByText('Permission denied')).toBeVisible();
    expect(screen.queryByTestId('owner-controls')).toBeNull();
    expect(mounts).toBe(0);
  });

  it('renders nothing extra when the host supplies no owner controls', async () => {
    const { container } = mount(GRANTED);
    await screen.findByRole('tablist');
    expect(container.querySelector('[data-jini-part="security.owner-controls"]')).toBeNull();
  });

  it('keeps the slot mounted across a tab change', async () => {
    mount(GRANTED, <OwnerControls />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Root key' }));
    expect(await screen.findByRole('tab', { name: 'Root key', selected: true })).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: 'Access tokens' }));
    expect(screen.getAllByTestId('owner-controls')).toHaveLength(1);
    expect(mounts).toBe(1);
  });
});
