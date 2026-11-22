import { render, renderHook, screen } from '@testing-library/react';
import { createRef, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AdminKitProvider, Button, Icon, type KitIconName, useAdminKitValues, useAdminThemeKit, useDirtyGuard, useFetchQuery, useMediaProviderRules, useT } from '../kit.js';
import { fakeAdminKit, fixtureQuery } from '../testing-kit.js';
import { renderWithAdminKit } from './render-with-admin-kit.js';

describe('admin kit contract', () => {
  it('throws a plain-words error when a facade renders outside a provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Button>x</Button>)).toThrow(/need <AdminKitProvider kit=/);
    spy.mockRestore();
  });

  it('keeps the first kit when the provider re-renders with another', () => {
    const second = vi.fn(() => <span>second</span>);
    const first = fakeAdminKit();
    const other = fakeAdminKit({ components: { Button: second } });
    const view = render(<AdminKitProvider kit={first}><Button>one</Button></AdminKitProvider>);
    view.rerender(<AdminKitProvider kit={other}><Button>one</Button></AdminKitProvider>);
    expect(second).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'one' })).toBeTruthy();
  });

  it('forwards props and the ref to the kit component', () => {
    const received = vi.fn();
    const kit = fakeAdminKit({ components: { Button: (p) => <button ref={p.ref} onClick={() => p.onPress?.({})}>{p.children}</button> } });
    const ref = createRef<HTMLButtonElement>();
    renderWithAdminKit(<Button ref={ref} onPress={received}>go</Button>, { kit });
    screen.getByRole('button', { name: 'go' }).click();
    expect(received).toHaveBeenCalledWith({});
    expect(ref.current).toBe(screen.getByRole('button', { name: 'go' }));
  });

  it('hook facades return the kit values', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AdminKitProvider kit={fakeAdminKit({ query: fixtureQuery({ data: 'rows' }) })}>{children}</AdminKitProvider>
    );
    expect(renderHook(() => useDirtyGuard({ current: 1, original: 2 }), { wrapper }).result.current.isDirty).toBe(true);
    expect(renderHook(() => useFetchQuery({ key: ['a'], fetch: async () => 'x' }), { wrapper }).result.current.data).toBe('rows');
    expect(renderHook(() => useMediaProviderRules(), { wrapper }).result.current.maskedKeyLabel({ entry: undefined })).toBeNull();
    expect(renderHook(() => useAdminThemeKit(), { wrapper }).result.current.resolveColorScheme({ preference: 'dark' })).toBe('dark');
  });
});


it('uses an injected kit and forwards the original button ref without the hook prop', () => {
  const received = vi.fn();
  const kit = fakeAdminKit({ components: { Button: (props) => {
    received(props);
    return <button ref={props.ref}>{props.children}</button>;
  } } });
  const ref = createRef<HTMLButtonElement>();
  render(<Button ref={ref} useAdminKitHook={() => kit}>Injected button</Button>);
  expect(ref.current).toBe(screen.getByRole('button', { name: 'Injected button' }));
  expect(received.mock.calls[0]![0]).not.toHaveProperty('useAdminKitHook');
});

describe('admin kit: UI icon, UI translator and injected values (A-K2-0a)', () => {
  it('renders the injected Icon with the props the screen passes, through the provider', () => {
    const received = vi.fn();
    const kit = fakeAdminKit({ components: { Icon: (props) => {
      received(props);
      return <svg role="img" aria-label={props['aria-label']} data-icon={props.name} />;
    } } });
    renderWithAdminKit(<Icon name="play" size={18} aria-label="Video file" />, { kit });
    expect(screen.getByRole('img', { name: 'Video file' }).getAttribute('data-icon')).toBe('play');
    // The slot always hands the implementation a `ref` (null here); every screen prop arrives unchanged.
    expect(received).toHaveBeenCalledWith({ name: 'play', size: 18, 'aria-label': 'Video file', ref: null });
  });

  it('the useT facade returns the UI translator the host injected', () => {
    const uiTranslator = (key: string) => `ui-sentinel:${key}`;
    const kit = fakeAdminKit({ hooks: { useT: () => uiTranslator } });
    const wrapper = ({ children }: { children: ReactNode }) => <AdminKitProvider kit={kit}>{children}</AdminKitProvider>;
    const t = renderHook(() => useT(), { wrapper }).result.current;
    expect(t).toBe(uiTranslator);
    expect(t('Save')).toBe('ui-sentinel:Save');
  });

  it('routes the glyphs the migrating admin screens render through the injected Icon', () => {
    // Database, import-export, library, media and skills screens render these once they import the kit Icon.
    const names = [
      'timeline', 'migrate-forward', 'tray-export', 'tray-import', 'more-horizontal-outline', 'tray-upload', 'document-lines',
      'tiles-four', 'picture-frame', 'video-frame', 'cloud-outline', 'bin-lidded', 'document-marked',
    ] as const satisfies readonly KitIconName[];
    const kit = fakeAdminKit({ components: { Icon: (props) => <svg role="img" aria-label={props.name} data-icon={props.name} /> } });
    renderWithAdminKit(<>{names.map((name) => <Icon key={name} name={name} />)}</>, { kit });
    expect(screen.getAllByRole('img').map((el) => el.getAttribute('data-icon'))).toEqual([...names]);
  });

  it('the useT and values facades take empty required/optional objects and still return the injected objects', () => {
    const uiTranslator = (key: string, vars?: Readonly<Record<string, string | number>>) => `${key}:${vars?.n ?? ''}`;
    const kit = fakeAdminKit({ hooks: { useT: () => uiTranslator } });
    const wrapper = ({ children }: { children: ReactNode }) => <AdminKitProvider kit={kit}>{children}</AdminKitProvider>;
    const read = renderHook(() => ({ t: useT({}, {}), values: useAdminKitValues({}, {}), bare: useAdminKitValues() }), { wrapper }).result.current;
    expect(read.t).toBe(uiTranslator);
    expect(read.t('Count', { n: 2 })).toBe('Count:2');
    expect(read.values).toBe(kit.values);
    expect(read.bare).toBe(kit.values);
  });

  it('hands screens the exact injected values, not copies', () => {
    const values = {
      SETTINGS_DIALOG_DICTIONARIES: { en: { Save: 'Save' } },
      DEFAULT_NOTIFICATIONS_PREFERENCES: { soundEnabled: false, successSoundId: 'ding', failureSoundId: 'buzz', desktopEnabled: false },
      UNREACHABLE_RETRY_DELAYS_MS: [1_000, 2_000],
      LOCAL_BACKUP_PRINCIPAL_ID: 'local-tab-backup',
    };
    const wrapper = ({ children }: { children: ReactNode }) => <AdminKitProvider kit={fakeAdminKit({ values })}>{children}</AdminKitProvider>;
    const read = renderHook(() => useAdminKitValues(), { wrapper }).result.current;
    expect(read.SETTINGS_DIALOG_DICTIONARIES).toBe(values.SETTINGS_DIALOG_DICTIONARIES);
    expect(read.DEFAULT_NOTIFICATIONS_PREFERENCES).toBe(values.DEFAULT_NOTIFICATIONS_PREFERENCES);
    expect(read.UNREACHABLE_RETRY_DELAYS_MS).toBe(values.UNREACHABLE_RETRY_DELAYS_MS);
    expect(read.LOCAL_BACKUP_PRINCIPAL_ID).toBe('local-tab-backup');
  });
});
