import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { KitProvider } from '@jini-ai/ui-kit/react';
import type { useRootKeyTab } from '../hooks/RootKeyTab.hooks.js';
import { RootKeyTab } from '../tabs/RootKeyTab.js';
type RootKeyView = ReturnType<typeof useRootKeyTab>;
const state = vi.hoisted((): { vm: RootKeyView | null } => ({ vm: null }));
vi.mock('../hooks/RootKeyTab.hooks.js', () => ({ useRootKeyTab: () => state.vm }));
const noop = () => {};
function view(over: Partial<RootKeyView> = {}): RootKeyView {
  return { denied: false, loading: false, saving: false, status: undefined, error: undefined, result: undefined, scopeNotice: 'Scope notice', token: '', confirm: '', confirming: false, preview: undefined, locked: false, canGenerate: false, canConfirm: false,
    onToken: noop, onConfirmText: noop, generate: noop, unlock: noop, previewFresh: noop, cancelFresh: noop, confirmFresh: async () => {}, ...over };
}
function show(over: Partial<RootKeyView> = {}) { state.vm = view(over); return render(<KitProvider><RootKeyTab params={{}} permissions={[]} /></KitProvider>); }
afterEach(cleanup);
describe('RootKeyTab', () => {
  it('renders only the denial when denied', () => { const { container } = show({ denied: true, canGenerate: true }); expect(container.textContent).toBe('Permission denied'); });
  it('renders only the scope notice when idle', () => { const { container } = show(); expect(container.textContent).toBe('Scope notice'); expect(screen.getByRole('region', { name: 'Root key' })).toBeTruthy(); });
  it('shows a spinner while loading', () => { const { container } = show({ loading: true }); expect(container.innerHTML).toContain('Loading root key status…'); });
  it('shows an error and a result', () => { show({ error: 'Failed reason', result: 'Done result' }); expect(screen.getByText('Failed reason')).toBeTruthy(); expect(screen.getByText('Done result')).toBeTruthy(); });
  it('shows the status line', () => { show({ status: { active: true, source: 'file', state: 'active', keyFilePath: '/k', runtimeMode: 'local', fingerprint: 'fp' } }); expect(screen.getByText('active · fp · file')).toBeTruthy(); });
  it('offers generation only when allowed', () => { show({ canGenerate: true }); expect(screen.getByRole('button', { name: 'Create root key' })).toBeTruthy(); });
  it('offers unlock and start fresh for a locked key with a private password field', () => {
    show({ locked: true }); expect(screen.getByLabelText('Old root key').getAttribute('type')).toBe('password');
    expect(screen.getByLabelText('Old root key').getAttribute('data-agent-private')).toBe('true');
    expect(screen.getByRole('button', { name: 'Unlock saved credentials' })).toBeTruthy(); expect(screen.getByRole('button', { name: 'Start fresh' })).toBeTruthy();
  });
  it('shows the start-fresh dialog with preview detail and affected receivers', () => {
    show({ confirming: true, preview: { removes: 3, detail: 'Preview detail', runtimeMode: 'local', affectedWebhooks: [{ label: 'Hook', targetUrl: 'https://h' }] } });
    expect(screen.getByText('Preview detail')).toBeTruthy(); expect(screen.getByText('3 credentials will be removed.')).toBeTruthy(); expect(screen.getByText('Hook · https://h')).toBeTruthy(); expect(screen.getByLabelText('Type START FRESH')).toBeTruthy();
  });
  it('shows the start-fresh dialog before a preview arrives', () => { show({ confirming: true }); expect(screen.getByText('credentials will be removed.')).toBeTruthy(); });
});
