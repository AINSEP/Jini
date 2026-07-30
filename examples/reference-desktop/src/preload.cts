const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');

contextBridge.exposeInMainWorld('__jiniPlaygroundDesktop', {
  pickWorkingDirectory(defaultPath?: string): Promise<string | null> {
    return ipcRenderer.invoke('jini:pick-working-directory', defaultPath);
  },
  normalizeWorkingDirectory(path: string): Promise<string | null> {
    return ipcRenderer.invoke('jini:normalize-working-directory', path);
  },
  recentDirectories(): Promise<string[]> {
    return ipcRenderer.invoke('jini:recent-directories');
  },
  directoryExists(path: string): Promise<boolean> {
    return ipcRenderer.invoke('jini:directory-exists', path);
  },
});
