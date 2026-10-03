import { copyToClipboard } from '../../utils/copy-to-clipboard.js';
import type { ViewerClipboardPort, ViewerShellDependencies } from './ports.js';

/** Real browser clipboard implementation (Clipboard API with an
 *  `execCommand('copy')` fallback) — this touches only generic browser
 *  APIs, so it ships for real rather than as a fake, same reasoning as
 *  `features/connectors/`'s `createBrowserConnectorAuthPendingStorage`. */
export function createBrowserViewerClipboard(): ViewerClipboardPort {
  return {
    copyText: (text: string) => copyToClipboard({ text }),
  };
}

export function createDefaultViewerShellDependencies(): ViewerShellDependencies {
  return {
    clipboard: createBrowserViewerClipboard(),
  };
}
