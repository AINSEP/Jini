import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '../../../__tests__/fetch-query-support.js';
import { SourceControlCredentialFields } from '../components/SourceControlCredentialFields.js';
import type { useProvidersTab } from '../hooks/ProvidersTab.hooks.js';
import type { useSourceControlCredentialFields } from '../hooks/SourceControlCredentialFields.hooks.js';
import type { useSourceControlPage } from '../hooks/SourceControlPage.hooks.js';
import { SourceControlPage } from '../pages/SourceControlPage.js';
import { ProvidersTab } from '../tabs/ProvidersTab.js';

/**
 * @file One fake-hook output test per source-control component that takes its hook as a prop
 * (hook-injection rule). Each fake returns text the real hook can never produce, so seeing it rendered
 * proves the injected hook fed the markup; handler fakes prove events reached the injected hook. A fake
 * returns only the fields its component reads, hence the single `as` in `fake`. The `jini-`
 * class-prefix loop applies when a component moves, so it is not asserted here.
 */
afterEach(cleanup);

const fake = <H extends (...args: never[]) => unknown>(vm: Partial<ReturnType<H>>) => vi.fn((..._args: Parameters<H>) => vm as ReturnType<H>);

describe('source-control components render from their injected hooks', () => {
  it('SourceControlCredentialFields shows the hint and routes Save to the fake hook', () => {
    const save = vi.fn();
    const hook = fake<typeof useSourceControlCredentialFields>({
      tokenLabel: 'FAKE-TOKEN-LABEL', token: '', onToken: vi.fn(), saving: false, tokenRef: { current: null } as never, hint: 'FAKE-HINT', hasGuidance: false, fields: [],
      save, disabled: false, label: 'FAKE-PROVIDER', error: 'FAKE-ERROR',
    });
    render(<SourceControlCredentialFields row={{ id: 'real' } as never} useSourceControlCredentialFieldsHook={hook} />);
    expect(screen.getByText('FAKE-HINT')).toBeTruthy();
    expect(screen.getByText('FAKE-ERROR')).toBeTruthy();
    fireEvent.click(screen.getByText('Save FAKE-PROVIDER token'));
    expect(save).toHaveBeenCalledOnce();
  });

  it('SourceControlPage shows the permission notice of the fake hook', () => {
    const hook = fake<typeof useSourceControlPage>({ denied: true });
    render(<SourceControlPage description={{ label: 'FAKE-PAGE' } as never} tabs={{}} useSourceControlPageHook={hook} />);
    expect(screen.getByText('FAKE-PAGE')).toBeTruthy();
    expect(screen.getByText(/permission/i)).toBeTruthy();
  });

  it('ProvidersTab shows the errors of the fake hook and routes Reload to it', () => {
    const reload = vi.fn();
    const hook = fake<typeof useProvidersTab>({ denied: false, errors: ['FAKE-ERROR'], loading: false, reload, rows: [] });
    render(<ProvidersTab params={{}} permissions={[]} useProvidersTabHook={hook} />);
    expect(screen.getByText('FAKE-ERROR')).toBeTruthy();
    fireEvent.click(screen.getByText('Reload connections'));
    expect(reload).toHaveBeenCalledOnce();
  });
});
