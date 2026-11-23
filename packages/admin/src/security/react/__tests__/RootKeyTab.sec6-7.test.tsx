import { TestChipField } from './chip-field.fixture.js';
import { Suspense } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '../../../__tests__/fetch-query-support.js';
import { AGENT_ELEMENT_ATTRIBUTE } from '@jini-ai/core/agent-handles';
import { createDomPageDriver } from '@jini-ai/agentic/dom';
import { reactModuleUi } from '../../../core/react/module-ui.js';
import { createAdmin } from '../../../core/module/index.js';
import { createMemorySecurityApi, createMemoryRootKey } from '../../adapters/memory.js';
import type { RootKeyStatus } from '../../models.js';
import { security, type SecurityModuleOptions } from '../index.js';

// SEC-6 and SEC-7 (P9-SEC plan v2) through the real module, bound hooks and controller. Ports the
// reveal cases of the host's `SiteKeyTab.unit.test.tsx`, its `SiteKeyTab.agent-secrecy.unit.test.tsx`
// (with the real page driver) and the `SiteKeyRecoveryCard.unit.test.tsx` flows. Fixture values only.
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const HEX = 'a3f9'.repeat(16);
const ACTIVE: RootKeyStatus = { active: true, source: 'file', state: 'active', keyFilePath: '/srv/root.key', runtimeMode: 'local', fingerprint: 'fp-1' };
const LOCKED: RootKeyStatus = { active: false, source: 'none', state: 'mismatch', keyFilePath: '/srv/root.key', runtimeMode: 'local' };
function mount(rootKey = createMemoryRootKey({ status: ACTIVE, revealHex: HEX }), options: SecurityModuleOptions = {}) {
  const feature = security({ ui: reactModuleUi, ChipField: TestChipField }, options);
  const admin = createAdmin({ modules: [feature], ports: { securityApi: createMemorySecurityApi({}), rootKey } }, { permissions: ['security.read', 'admin.security.tokens.manage'] });
  const { Page, tabs } = feature.react.pages.secrets;
  return { rootKey, ...render(<feature.react.Provider admin={admin}><Suspense fallback="Loading"><Page tabs={tabs} description={admin.describe().pages[0]!} requestedTab="root-key" /></Suspense></feature.react.Provider>) };
}
const handlesIn = (root: ParentNode) => Array.from(root.querySelectorAll(`[${AGENT_ELEMENT_ATTRIBUTE}]`)).map(e => e.getAttribute(AGENT_ELEMENT_ATTRIBUTE) ?? '');

describe('SEC-6 reveal, copy and hide', () => {
  it('reveals, copies with a copied state, and hides', async () => {
    const writeText = vi.fn(async (_text: string) => {});
    mount(undefined, { clipboard: { writeText } });
    fireEvent.click(await screen.findByRole('button', { name: 'Reveal' }));
    expect(await screen.findByText(HEX)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByRole('button', { name: 'Copied!' })).toBeVisible(); expect(writeText).toHaveBeenCalledWith(HEX);
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    await waitFor(() => expect(screen.queryByText(HEX)).toBeNull());
  });
  it('offers no reveal control without a reveal port, or for an inactive key', async () => {
    const bare = createMemoryRootKey({ status: ACTIVE }); delete (bare as { reveal?: unknown }).reveal;
    mount(bare); await screen.findByText('Active: key file'); expect(screen.queryByRole('button', { name: 'Reveal' })).toBeNull();
    cleanup(); mount(createMemoryRootKey({ status: LOCKED, revealHex: HEX })); await screen.findByRole('button', { name: 'Unlock saved credentials' });
    expect(screen.queryByRole('button', { name: 'Reveal' })).toBeNull();
  });
  it('shows a reveal error and no value', async () => {
    const rootKey = createMemoryRootKey({ status: ACTIVE }); rootKey.reveal = () => Promise.reject(new Error(HEX));
    const { container } = mount(rootKey); fireEvent.click(await screen.findByRole('button', { name: 'Reveal' }));
    expect(await screen.findByText('Root key could not be revealed.')).toBeVisible(); expect(container.textContent).not.toContain(HEX);
  });
});

describe('SEC-6 the key is human-only (real page driver)', () => {
  it('the agent can neither invoke reveal through a published handle nor read the value', async () => {
    const { rootKey, container } = mount(); const spy = vi.spyOn(rootKey, 'reveal' as never);
    const reveal = await screen.findByRole('button', { name: 'Reveal' });
    expect(reveal).not.toHaveAttribute(AGENT_ELEMENT_ATTRIBUTE); expect(reveal.closest('[data-agent-private]')).not.toBeNull();
    // The test kit publishes no handles itself, so publish the page and the root-key section as
    // ancestors (as a host agent runtime would) to prove neither their click nor their text reaches the key.
    container.querySelector('[data-jini-part="security.page"]')!.setAttribute(AGENT_ELEMENT_ATTRIBUTE, 'security-page');
    container.querySelector('section[aria-label="Root key"]')!.setAttribute(AGENT_ELEMENT_ATTRIBUTE, 'security-root-key');
    const driver = createDomPageDriver({ root: container, pages: {} });
    for (const handle of handlesIn(container)) await driver.click({ handle });
    expect(spy).not.toHaveBeenCalled();
    fireEvent.click(reveal); await screen.findByText(HEX);
    for (const name of ['Copy', 'Hide']) { const b = screen.getByRole('button', { name }); expect(b).not.toHaveAttribute(AGENT_ELEMENT_ATTRIBUTE); expect(b.closest('[data-agent-private]')).not.toBeNull(); }
    expect(screen.getByText(HEX).closest('[data-agent-private]')).not.toBeNull();
    expect(handlesIn(container).join(' ')).not.toMatch(/reveal|copy|hide/);
    // The page publishes handles (the tab bar), yet nothing the driver reports carries the key.
    expect(handlesIn(container).length).toBeGreaterThan(0); const found = await driver.findElements({}); expect(found.length).toBeGreaterThan(0); expect(JSON.stringify(found)).not.toContain(HEX);
  });
});

describe('SEC-7 recovery parity', () => {
  it('a locked create refusal shows the recovery controls and host copy for its code', async () => {
    const rootKey = createMemoryRootKey({ status: { ...LOCKED, state: 'missing' } });
    rootKey.generate = () => Promise.reject(Object.assign(new Error(HEX), { code: 'KEY_DEPENDENT_DATA', detail: `echo ${HEX}` }));
    const describeError = ({ error }: { error: unknown }) => ({ code: (error as { code: string }).code, detail: (error as { detail: string }).detail });
    const describeRefusal = ({ code }: { code: string }) => (code === 'KEY_DEPENDENT_DATA' ? 'Saved credentials need their original key.' : undefined);
    const { container } = mount(rootKey, { describeError, describeRefusal });
    fireEvent.click(await screen.findByRole('button', { name: 'Create root key' }));
    expect(await screen.findByText('Saved credentials need their original key.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Unlock saved credentials' })).toBeVisible(); expect(container.textContent).not.toContain(HEX);
  });
  it('previewRequired: false — a failed preview still opens the confirm step and shows why', async () => {
    const rootKey = createMemoryRootKey({ status: LOCKED }); rootKey.previewStartFresh = () => Promise.reject(new Error(HEX)); const fresh = vi.spyOn(rootKey, 'startFresh');
    mount(rootKey, { rootKeyTab: { previewRequired: false } });
    fireEvent.click(await screen.findByRole('button', { name: 'Start fresh' }));
    const dialog = await screen.findByRole('alertdialog'); expect(dialog.textContent).toContain('Recovery preview unavailable'); expect(dialog.textContent).not.toContain(HEX);
    fireEvent.change(screen.getByLabelText('Type START FRESH'), { target: { value: 'START FRESH' } });
    fireEvent.click(screen.getByRole('button', { name: /^Start fresh —/ }));
    await waitFor(() => expect(fresh).toHaveBeenCalledTimes(1)); expect(fresh).toHaveBeenCalledWith({ confirm: 'START FRESH' }, expect.anything());
    expect(await screen.findByText('Done. Re-enter removed credentials.')).toBeVisible();
  });
  it('previewRequired: true (default) — a failed preview keeps the confirm step closed', async () => {
    const rootKey = createMemoryRootKey({ status: LOCKED }); rootKey.previewStartFresh = () => Promise.reject(new Error(HEX));
    mount(rootKey); fireEvent.click(await screen.findByRole('button', { name: 'Start fresh' }));
    expect(await screen.findByText('Recovery preview unavailable')).toBeVisible(); expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});
