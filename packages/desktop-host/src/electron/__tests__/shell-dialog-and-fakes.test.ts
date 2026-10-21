/** Folder-dialog edge results and the exported Electron test doubles' own documented behaviour. */
import { expect, it } from 'vitest';
import { createElectronShellPort } from '../electron-shell.js';
import { createFakeElectronApp, createFakeElectronDialog, createFakeElectronShell } from '../testing.js';

const port = (dialog: ReturnType<typeof createFakeElectronDialog>) =>
  createElectronShellPort({ shell: createFakeElectronShell({}), app: createFakeElectronApp({}), dialog });

it('returns null for a dialog that was confirmed with no folder, and the first folder otherwise', async () => {
  await expect(port(createFakeElectronDialog({}, { openDialogResult: { canceled: false, filePaths: [] } })).openFolderDialog({})).resolves.toBeNull();
  await expect(port(createFakeElectronDialog({}, { openDialogResult: { canceled: false, filePaths: ['/first', '/second'] } })).openFolderDialog({})).resolves.toBe('/first');
  await expect(port(createFakeElectronDialog({}, { openDialogResult: { canceled: true, filePaths: ['/ignored'] } })).openFolderDialog({})).resolves.toBeNull();
});

it('the fake dialog answers as a cancelled dialog unless scripted, and records the options it was shown', async () => {
  const dialog = createFakeElectronDialog({});
  await expect(port(dialog).openFolderDialog({}, { defaultPath: '/start' })).resolves.toBeNull();
  expect(dialog.lastShowOpenDialogOptions).toEqual({ properties: ['openDirectory'], defaultPath: '/start' });
});

it('the fake app lists recent documents newest first as they are added', () => {
  const app = createFakeElectronApp({}, { recentDocuments: ['/older'] });
  app.addRecentDocument({ path: '/newer' });
  app.addRecentDocument({ path: '/newest' });
  expect(app.getRecentDocuments()).toEqual(['/newest', '/newer', '/older']);
});
