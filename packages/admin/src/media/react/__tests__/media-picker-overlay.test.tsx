import { afterEach, expect, it } from 'vitest';
// The raw render on purpose: the shared test scope provides every domain's controller hook at the
// root, which would hide a picker that renders outside the media module's Provider.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FetchQueryProvider } from '@jini-ai/ui/fetch-query';
import { KitProvider } from '@jini-ai/ui-kit/react';
import { testAdminKit } from '../../../__tests__/fetch-query-support.js';
import { reactModuleUi } from '../../../core/react/module-ui.js';
import { AdminKitProvider } from '../../../react/kit.js';
import { createOverlayController } from '../../../react/overlays.js';
import { OverlayHost } from '../../../react/OverlayHost.js';
import { createMemoryMediaApi } from '../../adapters/memory.js';
import { media } from '../index.js';

afterEach(cleanup);

it('renders the picker the host overlay mounts outside the media Provider with the injected controller hook', async () => {
  const api = createMemoryMediaApi({});
  await api.upload({ filename: 'photo.png', contentType: 'image/png', dataBase64: 'bytes' });
  const overlays = createOverlayController({});
  const port = media({ ui: reactModuleUi, overlays }).factories.mediaPicker({ ports: { mediaApi: api }, permissions: ['media.read'] });
  render(
    <KitProvider>
      <AdminKitProvider kit={testAdminKit}>
        <FetchQueryProvider>
          <OverlayHost controller={overlays} />
        </FetchQueryProvider>
      </AdminKitProvider>
    </KitProvider>,
  );
  const chosen = port.pick({ accept: ['image/*'] });
  fireEvent.click(await screen.findByRole('button', { name: 'Choose' }, { timeout: 5000 }));
  expect(await chosen).toEqual(expect.objectContaining({ title: 'photo.png' }));
});
