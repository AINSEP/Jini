import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useProvidersTab } from '../hooks/ProvidersTab.hooks.js';
import { SourceControlPortsContext } from '../hooks/SourceControlPorts.hooks.js';
import type { SourceControlPorts } from '../hooks/SourceControlPorts.hooks.js';
import { createMemorySourceControlApi } from '../../adapters/memory.js';
import type { SourceControlCredential, SourceControlProvider } from '../../models.js';

const READ = ['source-control.read'], WRITE = ['source-control.read', 'source-control.credentials.write'];
const providers: SourceControlProvider[] = [
  { id: 'git', label: 'Git', credential: { tokenField: 'pat', tokenPageUrl: 'https://git.test/tokens', fields: [
    { name: 'pat', label: 'Personal token', secret: true },
    { name: 'host', label: 'Host', required: true, userHelp: 'Your host', hint: 'h', help: 'x' },
    { name: 'org', label: 'Org', hint: 'Org hint', help: 'x' },
    { name: 'team', label: 'Team', help: 'Team help' },
  ] } },
  { id: 'lab', label: 'Lab', credential: { tokenField: 'token', tokenPageUrl: 'javascript:alert(1)', help: 'Lab help', fields: [] } },
  { id: 'bare', label: 'Bare' },
];
const saved = (providerId: string): SourceControlCredential => ({ id: `c-${providerId}`, providerId, label: 'Mine', configured: true, isDefault: true, createdAt: 'today', updatedAt: 'today' });

function mount({ permissions = WRITE, api = createMemorySourceControlApi({ providers, credentials: [saved('git'), saved('gone')] }), navigation }: {
  permissions?: string[]; api?: SourceControlPorts['sourceControlApi']; navigation?: SourceControlPorts['sourceControlNavigation'];
} = {}) {
  let first: ReturnType<typeof useProvidersTab> | undefined;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SourceControlPortsContext.Provider value={{ sourceControlApi: api, ...(navigation ? { sourceControlNavigation: navigation } : {}) }}>{children}</SourceControlPortsContext.Provider>
  );
  const view = renderHook(() => { const vm = useProvidersTab({ params: {}, permissions }); first ??= vm; return vm; }, { wrapper });
  return { ...view, api, first: () => first! };
}
const loaded = (view: ReturnType<typeof mount>) => waitFor(() => expect(view.result.current.loading).toBe(false));
const row = (view: ReturnType<typeof mount>, id: string) => view.result.current.rows.find(item => item.id === id)!;

describe('source-control useProvidersTab', () => {
  it('starts loading with no rows and inert handlers', () => {
    const view = mount();
    const first = view.first();
    expect(first).toMatchObject({ denied: false, loading: true, rows: [], errors: [], canManage: false });
    expect(() => { first.reload(); first.manage(); }).not.toThrow();
  });

  it('describes saved, unsaved and unlisted connections', async () => {
    const view = mount();
    await loaded(view);
    expect(view.result.current.rows.map(item => item.id)).toEqual(['git', 'lab', 'bare', 'gone']);
    expect(row(view, 'git')).toMatchObject({ heading: 'Git', connected: true, defaultOpen: false, canEdit: true, unlisted: false, tokenLabel: 'Git Personal token',
      hint: 'Leave blank to keep the current token.', tokenPageUrl: 'https://git.test/tokens', hasGuidance: true, disabled: true });
    expect(row(view, 'git').fields).toEqual([
      expect.objectContaining({ name: 'host', label: 'Git Host', value: '', secret: false, required: true, hint: 'Your host' }),
      expect.objectContaining({ name: 'org', secret: false, required: false, hint: 'Org hint' }),
      expect.objectContaining({ name: 'team', hint: 'Team help' }),
    ]);
    expect(row(view, 'lab')).toMatchObject({ heading: 'Connect Lab', connected: false, defaultOpen: true, hint: 'Once saved, the token is never displayed again.', tokenPageUrl: undefined, help: 'Lab help', hasGuidance: true });
    expect(row(view, 'bare')).toMatchObject({ defaultOpen: false, tokenLabel: 'Bare Access token', hasGuidance: false, fields: [] });
    expect(row(view, 'gone')).toMatchObject({ label: 'gone', unlisted: true, canEdit: false, connected: true });
  });

  it('opens no row by default when every listed provider is connected', async () => {
    const view = mount({ api: createMemorySourceControlApi({ providers: [providers[2]!], credentials: [saved('bare')] }) });
    await loaded(view);
    expect(row(view, 'bare').defaultOpen).toBe(false);
  });

  it('is denied without the read grant and read-only without the write grant', async () => {
    expect(mount({ permissions: [] }).result.current.denied).toBe(true);
    const view = mount({ permissions: READ });
    await loaded(view);
    expect(row(view, 'lab')).toMatchObject({ canEdit: false, disabled: true });
  });

  it('edits fields and the token, then replaces the saved connection', async () => {
    const view = mount();
    await loaded(view);
    const update = vi.spyOn(view.api, 'update');
    act(() => row(view, 'git').fields[0]!.onValueChange({ value: 'git.example' }));
    act(() => row(view, 'git').onToken({ value: 'tok' }));
    expect(row(view, 'git')).toMatchObject({ token: 'tok', disabled: false });
    expect(row(view, 'git').fields[0]!.value).toBe('git.example');
    await act(async () => row(view, 'git').save());
    expect(update).toHaveBeenCalledWith({ id: 'c-git', patch: { connection: { host: 'git.example', providerId: 'git', token: 'tok' } } }, { signal: expect.any(AbortSignal) });
  });

  it('collects connection and catalog failures, and reloads', async () => {
    const api = createMemorySourceControlApi({ providers });
    const view = mount({ api: { ...api, list: async () => { throw new Error('down'); }, providers: async () => { throw new Error('down'); } } });
    await loaded(view);
    expect(view.result.current.errors).toEqual(['Connections unavailable', 'Provider catalog unavailable']);
    const fresh = mount({ api });
    await loaded(fresh);
    const list = vi.spyOn(api, 'list');
    act(() => fresh.result.current.reload());
    await loaded(fresh);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('opens host credential management when the host provides it', () => {
    const navigation = { open: vi.fn() };
    const view = mount({ navigation });
    expect(view.result.current.canManage).toBe(true);
    view.result.current.manage();
    expect(navigation.open).toHaveBeenCalledWith({ kind: 'source-control' });
  });
});
