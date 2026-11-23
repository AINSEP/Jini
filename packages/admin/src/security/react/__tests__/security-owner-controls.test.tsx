import { Suspense, useEffect } from 'react';
import { afterEach, describe, it, expect } from 'vitest';
import { render, screen, fireEvent, cleanup } from '../../../__tests__/fetch-query-support.js';
import { reactModuleUi } from '../../../core/react/module-ui.js';
import { createAdmin } from '../../../core/module/index.js';
import { security } from '../index.js';
import { createMemorySecurityApi, createMemoryRootKey } from '../../adapters/memory.js';

afterEach(cleanup);
let effects = 0;
function OwnerCard() { useEffect(() => { effects += 1; }, []); return <div data-testid="owner-controls">owner</div>; }
function mount({ permissions, controls = true }: { permissions: readonly string[]; controls?: boolean }) {
  const feature = security({ ui: reactModuleUi });
  const admin = createAdmin({ modules: [feature], ports: { securityApi: createMemorySecurityApi({}), rootKey: createMemoryRootKey({}) } }, { permissions });
  const { Page, tabs } = feature.react.pages.secrets;
  render(<feature.react.Provider admin={admin} {...(controls ? { ownerControls: <OwnerCard /> } : {})}><Suspense fallback="Loading"><Page tabs={tabs} description={admin.describe().pages[0]!} /></Suspense></feature.react.Provider>);
}

describe('security owner-controls slot (SEC-2)', () => {
  it('renders the host controls once, before the TabBar', async () => {
    mount({ permissions: ['security.read'] });
    const tablist = await screen.findByRole('tablist');
    const slots = screen.getAllByTestId('owner-controls');
    expect(slots).toHaveLength(1);
    expect(slots[0]!.compareDocumentPosition(tablist) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it('is absent when the page is denied', async () => {
    mount({ permissions: [] });
    await screen.findByText('Permission denied');
    expect(screen.queryByTestId('owner-controls')).toBeNull();
  });
  it('renders nothing extra when the host supplies none', async () => {
    mount({ permissions: ['security.read'], controls: false });
    const tablist = await screen.findByRole('tablist');
    expect(tablist.previousElementSibling?.tagName).toBe('HEADER');
  });
  it('survives a tab change without remounting', async () => {
    effects = 0;
    mount({ permissions: ['security.read', 'admin.security.tokens.manage'] });
    fireEvent.click(await screen.findByRole('tab', { name: 'Root key' }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Access tokens' }));
    expect(screen.getAllByTestId('owner-controls')).toHaveLength(1);
    expect(effects).toBe(1);
  });
});
