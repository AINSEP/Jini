export interface JiniPlaygroundDesktopBridge {
  pickWorkingDirectory(defaultPath?: string): Promise<string | null>;
  normalizeWorkingDirectory(path: string): Promise<string | null>;
  recentDirectories(): Promise<string[]>;
  directoryExists(path: string): Promise<boolean>;
}

declare global {
  interface Window {
    __jiniPlaygroundDesktop?: JiniPlaygroundDesktopBridge;
  }
}

export function getDesktopBridge(): JiniPlaygroundDesktopBridge | undefined {
  return window.__jiniPlaygroundDesktop;
}
