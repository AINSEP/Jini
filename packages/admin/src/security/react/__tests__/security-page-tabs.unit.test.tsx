import { TestChipField } from './chip-field.fixture.js';
import { testClipboard } from './clipboard.fixture.js';
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reactModuleUi } from '../../../core/react/module-ui.js';
import { createAdmin } from '../../../core/module/index.js';
import { createMemorySecurityApi } from '../../adapters/memory.js';
import { englishSecurity } from '../../messages.en.js';
import { useSecurityPage } from '../hooks/SecurityPage.hooks.js';
import { security } from '../index.js';

afterEach(cleanup);

describe('security page tab bar entries (SEC-1)', () => {
  it('keeps a tab the page has no copy for, under its described label and without an agent handle', () => {
    const feature = security({ ui: reactModuleUi, ChipField: TestChipField, clipboard: testClipboard });
    const admin = createAdmin({ modules: [feature], ports: { securityApi: createMemorySecurityApi({}) } }, { permissions: ['security.read'] });
    const described = admin.describe().pages[0]!;
    const first = described.tabs[0]!;
    const description = { ...described, tabs: [...described.tabs, { ...first, id: first.id.replace(/[^.]+$/, 'audit'), label: 'Audit log' }] };
    const { result } = renderHook(() => useSecurityPage(
      { description, tabs: feature.react.pages.secrets.tabs, tabIcons: { 'access-tokens': <i>icon</i> } },
      { useSecurityTranslationHook: () => englishSecurity, useSecurityOwnerControlsHook: vi.fn(() => null) },
    ));
    const audit = result.current.tabs.find(tab => tab.id === 'audit');
    expect(audit).toEqual({ id: 'audit', label: 'Audit log' });
    const tokens = result.current.tabs.find(tab => tab.id === 'access-tokens');
    expect(tokens).toMatchObject({ label: 'Access tokens', handle: 'security-tab-access-tokens' });
    expect(tokens).toHaveProperty('icon');
  });
});
