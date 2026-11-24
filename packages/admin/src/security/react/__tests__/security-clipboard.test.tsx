import { TestChipField } from './chip-field.fixture.js';
import { Suspense } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '../../../__tests__/fetch-query-support.js';
import { reactModuleUi } from '../../../core/react/module-ui.js';
import { createAdmin } from '../../../core/module/index.js';
import { createMemorySecurityApi, createMemoryRootKey } from '../../adapters/memory.js';
import type { RootKeyStatus } from '../../models.js';
import { security } from '../index.js';

// The clipboard is a required host input: Jini never reaches for an ambient browser clipboard. The
// compile-time half is the `@ts-expect-error` below; the runtime half proves Copy writes only to the
// injected clipboard even when a browser clipboard exists. Fixture values only.
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const HEX = 'b7c2'.repeat(16);
const ACTIVE: RootKeyStatus = { active: true, source: 'file', state: 'active', keyFilePath: '/srv/root.key', runtimeMode: 'local', fingerprint: 'fp-1' };

describe('security() clipboard is host-injected', () => {
  it('refuses to build without a host clipboard (type-level)', () => {
    // @ts-expect-error `clipboard` is a required host input; there is no ambient default.
    const build = () => security({ ui: reactModuleUi, ChipField: TestChipField });
    expect(typeof build).toBe('function');
  });

  it('copies only to the injected clipboard, never the ambient browser one', async () => {
    const ambient = vi.fn(async (_text: string) => {});
    vi.stubGlobal('navigator', { ...globalThis.navigator, clipboard: { writeText: ambient } });
    const writeText = vi.fn(async (_text: string) => {});
    const feature = security({ ui: reactModuleUi, ChipField: TestChipField, clipboard: { writeText } });
    const admin = createAdmin({ modules: [feature], ports: { securityApi: createMemorySecurityApi({}), rootKey: createMemoryRootKey({ status: ACTIVE, revealHex: HEX }) } }, { permissions: ['security.read', 'admin.security.tokens.manage'] });
    const { Page, tabs } = feature.react.pages.secrets;
    render(<feature.react.Provider admin={admin}><Suspense fallback="Loading"><Page tabs={tabs} description={admin.describe().pages[0]!} requestedTab="root-key" /></Suspense></feature.react.Provider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Reveal' }));
    expect(await screen.findByText(HEX)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByRole('button', { name: 'Copied!' })).toBeVisible();
    expect(writeText).toHaveBeenCalledWith(HEX); expect(ambient).not.toHaveBeenCalled();
    // The secret reaches only the injected clipboard: never the rendered tree's attributes or the console.
    expect(document.body.innerHTML.split(HEX).length - 1).toBe(1);
  });
});
