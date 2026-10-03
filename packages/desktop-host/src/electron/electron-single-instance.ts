import { createSingleInstanceLockPort, type SingleInstanceApp, type SingleInstanceLockPort } from '../single-instance.js';
import type { ElectronAppLike } from './electron-surfaces.js';

export function createElectronSingleInstanceLockPort({ app }: { app: ElectronAppLike }): SingleInstanceLockPort {
  const adapted: SingleInstanceApp = {
    requestSingleInstanceLock: () => app.requestSingleInstanceLock(),
    quit: () => app.quit(),
    onSecondInstance: ({ listener }) => app.on({ event: 'second-instance', listener }),
  };
  return createSingleInstanceLockPort({ app: adapted });
}
