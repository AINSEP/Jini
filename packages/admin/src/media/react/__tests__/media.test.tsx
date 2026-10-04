import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act, configure } from '@testing-library/react';
import { StrictMode, Suspense, createRef } from 'react';
import { createAdmin, defineAdminModule } from '../../../core/module/index.js';
import { mediaPickerToken } from '../../../contracts/media-picker.js';
import type { MediaPickerPort } from '../../../contracts/media-picker.js';
import { createMemoryMediaApi, createMemoryMediaProviders } from '../../adapters/memory.js';
import { media } from '../index.js';
import { createOverlayController } from '../../../react/overlays.js';
import { OverlayHost } from '../../../react/OverlayHost.js';
import { KitProvider, createKit, Button, Dialog, TextField } from '@jini-ai/ui-kit/react';
import type { ButtonProps } from '@jini-ai/ui-kit/react';
import { MediaPurgeDialog } from '../components/MediaPurgeDialog.js';
import { useController } from '../../../react/use-controller.js';
import { bindReact } from '../../../react/bind-react.js';
// Lazy tab imports can exceed the default 1s under concurrent workspace builds.
configure({ asyncUtilTimeout: 5000 });
afterEach(cleanup);
async function fixture() {
  const api = createMemoryMediaApi({});
  await api.upload({ filename: 'photo.png', contentType: 'image/png', dataBase64: 'bytes' });
  await api.upload({ filename: 'clip.webm', contentType: 'video/webm', dataBase64: 'bytes' });
  const overlays = createOverlayController({});
  const module = media({ overlays });
  const admin = createAdmin(
    { modules: [module], ports: { mediaApi: api } },
    {
      permissions: [
        'media.read',
        'media.upload',
        'media.update',
        'media.trash',
        'media.delete.force',
        'media.providers',
      ],
    },
  );
  return { api, overlays, module, admin };
}
describe('media React slice', () => {
  it('lazily switches library presets and hides the optional Providers tab', async () => {
    const { module, admin } = await fixture();
    const { Page, tabs } = module.react.pages.library;
    expect(admin.describe().pages[0]?.tabs[3]?.reason).toBe(
      'optional port unavailable: mediaProviders',
    );
    render(
      <StrictMode>
        <module.react.Provider admin={admin}>
          <Suspense fallback="loading">
            <Page tabs={tabs} description={admin.describe().pages[0]!} />
          </Suspense>
        </module.react.Provider>
      </StrictMode>,
    );
    await screen.findByRole('heading', { name: 'photo.png' });
    expect(screen.getByRole('heading', { name: 'clip.webm' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'External Providers' })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Images' }));
    await screen.findByRole('heading', { name: 'photo.png' });
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'clip.webm' })).toBeNull());
    fireEvent.click(screen.getByRole('tab', { name: 'Videos' }));
    await screen.findByRole('heading', { name: 'clip.webm' });
    expect(screen.queryByRole('heading', { name: 'photo.png' })).toBeNull();
  }, 15000);
  it('provides a picker to an unrelated consumer through DI and an inherited overlay host', async () => {
    const { api, overlays, module } = await fixture();
    const consumer = defineAdminModule({
      id: 'consumer',
      requires: { mediaPicker: mediaPickerToken },
      pages: {},
    });
    const consumerBinding = bindReact({ module: consumer, views: {} });
    const admin = createAdmin(
      { modules: [module, consumer], ports: { mediaApi: api } },
      { permissions: ['media.read'] },
    );
    const selected = vi.fn();
    function Consumer() {
      const { mediaPicker } = consumerBinding.usePorts();
      return (
        <Button
          attrs={{ 'data-jini-part': 'consumer.pick' }}
          onPress={() => {
            void mediaPicker.pick({ accept: ['image/*'] }).then(selected);
          }}
        >
          Pick image
        </Button>
      );
    }
    render(
      <KitProvider>
        <consumerBinding.Provider admin={admin}>
          <Consumer />
        </consumerBinding.Provider>
        <OverlayHost controller={overlays} />
      </KitProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Pick image' }));
    await screen.findByRole('dialog', { name: 'Choose media' });
    await screen.findByRole('button', { name: 'Choose' });
    expect(screen.queryByRole('heading', { name: 'clip.webm' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Choose' }));
    await waitFor(() =>
      expect(selected).toHaveBeenCalledWith(expect.objectContaining({ title: 'photo.png' })),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(Object.keys(admin.scope({ module: consumer }))).toEqual(['mediaPicker']);
  });
  it('cancels the picker on abort, refuses concurrency, and cancels on host unmount', async () => {
    const { api, overlays, module } = await fixture();
    const consumer = defineAdminModule({
      id: 'consumer',
      requires: { mediaPicker: mediaPickerToken },
      pages: {},
    });
    const admin = createAdmin(
      { modules: [module, consumer], ports: { mediaApi: api } },
      { permissions: ['media.read'] },
    );
    const picker: MediaPickerPort = admin.scope({ module: consumer }).mediaPicker;
    const view = render(<OverlayHost controller={overlays} />);
    const abort = new AbortController();
    let chosen!: Promise<unknown>;
    await act(async () => {
      chosen = picker.pick({ accept: [] }, { signal: abort.signal });
    });
    await screen.findByRole('dialog');
    await expect(picker.pick({ accept: [] })).rejects.toThrow('already open');
    await act(async () => {
      abort.abort();
    });
    expect(await chosen).toBeNull();
    await act(async () => {
      chosen = picker.pick({ accept: [] });
    });
    await screen.findByRole('dialog');
    view.unmount();
    expect(await chosen).toBeNull();
    admin.dispose();
  });
  it('fails closed without a media.read grant', async () => {
    const { api, module } = await fixture();
    const consumer = defineAdminModule({
      id: 'consumer',
      requires: { mediaPicker: mediaPickerToken },
      pages: {},
    });
    const admin = createAdmin({ modules: [module, consumer], ports: { mediaApi: api } });
    await expect(
      admin.scope({ module: consumer }).mediaPicker.pick({ accept: [] }),
    ).rejects.toThrow('Permission denied');
    expect(admin.describe().pages[0]?.visible).toBe(false);
  });
  it('overrides only Button and forwards attrs to the actionable element', () => {
    const press = vi.fn();
    function HostButton(props: ButtonProps) {
      return (
        <button
          {...props.attrs}
          onClick={() => props.onPress?.({})}
          disabled={props.disabled || props.pending}
          data-host-button="yes"
        >
          {props.children}
        </button>
      );
    }
    render(
      <KitProvider kit={createKit({ components: { Button: HostButton } })}>
        <Button
          attrs={{ 'data-jini-part': 'test.button', 'data-agent-element': 'test-press' }}
          onPress={press}
        >
          Host action
        </Button>
        <TextField
          attrs={{ 'data-jini-part': 'test.field', 'data-agent-element': 'test-field' }}
          label="Default field"
          value="text"
          onValueChange={() => {}}
        />
      </KitProvider>,
    );
    const button = screen.getByRole('button', { name: 'Host action' });
    expect(button).toHaveAttribute('data-host-button', 'yes');
    expect(button).toHaveAttribute('data-agent-element', 'test-press');
    fireEvent.click(button);
    expect(press).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('textbox', { name: 'Default field' })).toHaveAttribute(
      'data-agent-element',
      'test-field',
    );
  });
  it('native controls forward parts, preserve controlled values and block pending activation', () => {
    const press = vi.fn(),
      change = vi.fn();
    render(
      <>
        <Button attrs={{ 'data-jini-part': 'test.button' }} pending onPress={press}>
          Pending
        </Button>
        <TextField
          attrs={{ 'data-jini-part': 'test.field' }}
          label="Name"
          value="before"
          onValueChange={change}
        />
        <Dialog
          attrs={{ 'data-jini-part': 'test.dialog', 'data-agent-element': 'dialog' }}
          title="Example"
          open
          onClose={() => {}}
        >
          Content
        </Dialog>
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Pending' }));
    expect(press).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'after' } });
    expect(change).toHaveBeenCalledWith({ value: 'after' });
    expect(screen.getByRole('dialog')).toHaveAttribute('data-jini-part', 'test.dialog');
  });
  it('uses guarded overridable destructive controls and blocks Escape while pending', () => {
    const cancel = vi.fn(),
      confirm = vi.fn();
    const { rerender } = render(
      <MediaPurgeDialog open pending onCancel={cancel} onConfirm={confirm} />,
    );
    fireEvent(screen.getByRole('alertdialog'), new Event('cancel', { bubbles: true, cancelable: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently', description: 'This permanently deletes the file. This cannot be undone.' }));
    expect(cancel).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    rerender(<MediaPurgeDialog open pending={false} onCancel={cancel} onConfirm={confirm} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently', description: 'This permanently deletes the file. This cannot be undone.' }));
    expect(confirm).toHaveBeenCalledTimes(1);
  });
  it('disposes each controller attachment under StrictMode and dependency changes', async () => {
    const disposed: number[] = [];
    let created = 0;
    function Probe({ id }: { id: number }) {
      useController({
        create: () => {
          const instance = ++created;
          return {
            getSnapshot: () => id,
            subscribe: () => () => {},
            dispose: () => {
              disposed.push(instance);
            },
          };
        },
        dependencies: [id],
      });
      return null;
    }
    const view = render(
      <StrictMode>
        <Probe id={1} />
      </StrictMode>,
    );
    await waitFor(() => expect(created).toBe(2));
    expect(disposed).toEqual([1]);
    view.rerender(
      <StrictMode>
        <Probe id={2} />
      </StrictMode>,
    );
    await waitFor(() => expect(created).toBe(3));
    view.unmount();
    expect(disposed).toEqual([1, 2, 3]);
  });
});

it('renders the optional credential tab without exposing saved secrets', async () => {
  const { api, overlays } = await fixture();
  const module = media({ overlays });
  const providers = createMemoryMediaProviders({
    providers: [{ id: 'example', label: 'Example', configured: false }],
  });
  const admin = createAdmin(
    { modules: [module], ports: { mediaApi: api, mediaProviders: providers } },
    { permissions: ['media.read', 'media.providers'] },
  );
  const { Page, tabs } = module.react.pages.library;
  render(
    <module.react.Provider admin={admin}>
      <Suspense fallback="loading">
        <Page
          tabs={tabs}
          description={admin.describe().pages[0]!}
          requestedTab="external-providers"
        />
      </Suspense>
    </module.react.Provider>,
  );
  // A cold lazy Providers import alone can take more than 5s on a loaded machine.
  const credential = await screen.findByLabelText('Example credential', {}, { timeout: 15000 });
  expect(credential).toHaveAttribute('type', 'password');
  fireEvent.change(credential, { target: { value: 'private-secret' } });
  expect(screen.getByText('Unsaved')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  // The saved state is a marker only: the field empties and the secret appears nowhere.
  await screen.findByText('Saved (••••)');
  expect(credential).toHaveValue('');
  expect(credential).toHaveAttribute('placeholder', '••••');
  expect(document.body.innerHTML).not.toContain('private-secret');
  expect(await providers.list({})).toEqual([{ id: 'example', label: 'Example', configured: true }]);
  fireEvent.click(screen.getByRole('button', { name: 'Example Show' }));
  expect(credential).toHaveAttribute('type', 'text');
  expect(credential).toHaveValue('');
  fireEvent.click(screen.getByRole('button', { name: 'Example Clear' }));
  await waitFor(() => expect(screen.queryByText('Saved (••••)')).toBeNull());
  expect(await providers.list({})).toEqual([{ id: 'example', label: 'Example', configured: false }]);
}, 30000);
it('renders a read-only media page when write grants are absent', async () => {
  const { api, overlays } = await fixture();
  const module = media({ overlays });
  const admin = createAdmin(
    { modules: [module], ports: { mediaApi: api } },
    { permissions: ['media.read'] },
  );
  const { Page, tabs } = module.react.pages.library;
  render(
    <module.react.Provider admin={admin}>
      <Suspense fallback="loading">
        <Page tabs={tabs} description={admin.describe().pages[0]!} />
      </Suspense>
    </module.react.Provider>,
  );
  await screen.findByRole('heading', { name: 'photo.png' });
  expect(screen.queryByRole('button', { name: 'Upload' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Edit metadata' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Trash' })).toBeNull();
});
it('forwards kit refs to focusable controls and restores dialog trigger focus', () => {
  const button = createRef<HTMLButtonElement>(),
    field = createRef<HTMLInputElement>(),
    dialog = createRef<HTMLDialogElement>();
  const { rerender } = render(
    <>
      <Button ref={button} attrs={{ 'data-jini-part': 'ref.button' }}>
        Trigger
      </Button>
      <TextField
        ref={field}
        attrs={{ 'data-jini-part': 'ref.field' }}
        label="Ref field"
        value=""
        onValueChange={() => {}}
      />
    </>,
  );
  expect(button.current).toBe(screen.getByRole('button'));
  expect(field.current).toBe(screen.getByRole('textbox'));
  button.current!.focus();
  rerender(
    <>
      <Button ref={button} attrs={{ 'data-jini-part': 'ref.button' }}>
        Trigger
      </Button>
      <TextField
        ref={field}
        attrs={{ 'data-jini-part': 'ref.field' }}
        label="Ref field"
        value=""
        onValueChange={() => {}}
      />
      <Dialog
        ref={dialog}
        attrs={{ 'data-jini-part': 'ref.dialog' }}
        open
        title="Ref dialog"
        onClose={() => {}}
      >
        Content
      </Dialog>
    </>,
  );
  expect(dialog.current).toBe(screen.getByRole('dialog'));
  expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  rerender(
    <>
      <Button ref={button} attrs={{ 'data-jini-part': 'ref.button' }}>
        Trigger
      </Button>
      <TextField
        ref={field}
        attrs={{ 'data-jini-part': 'ref.field' }}
        label="Ref field"
        value=""
        onValueChange={() => {}}
      />
    </>,
  );
  expect(button.current).toHaveFocus();
});
