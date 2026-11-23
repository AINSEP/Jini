/**
 * @file Main's half of a guest page's hand-off to a screen of the host's own app window: the page
 * asks over an invoke channel, main checks the sender the way the host's other guest-facing
 * channels do, brings the app window forward, and pushes the bounded request to its renderer.
 * Channels, the payload parser and the refusal wording are the host's; this owns only the order.
 */

/** The slice of an app `BrowserWindow` the hand-off touches. */
export interface HandoffWindow<Payload> {
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
  webContents: { send(channel: string, payload: Payload): void };
}

/** `request` is invoked by the guest page; `open` is pushed to the app window's renderer. */
export interface HandoffChannels {
  request: string;
  open: string;
}

/** `opened: false` when no app window is open to show the requested screen. */
export interface HandoffResult {
  opened: boolean;
}

/** The slice of Electron's `ipcMain` the hand-off registers on. */
export interface HandoffIpcMain {
  handle(channel: string, handler: (event: { senderFrame?: { url?: unknown } | null } | undefined, raw: unknown) => HandoffResult): void;
}

/**
 * Register once, app-wide, before any window can call it.
 * @param required.isTrustedSender whether the calling frame's URL is a page this shell serves.
 * @param required.windows the open app windows, read at call time; the first one is shown.
 * @param required.parse turns the untrusted invoke argument into the bounded payload main forwards.
 * @param required.senderRefused the error message an untrusted sender receives.
 * @complexity O(w) in open app windows per request, plus `parse`.
 */
export function registerHandoffForwarding<Payload>({ ipcMain, isTrustedSender, windows, channels, parse, senderRefused }: {
  ipcMain: HandoffIpcMain;
  isTrustedSender: (required: { senderUrl: string }) => boolean;
  windows: () => readonly HandoffWindow<Payload>[];
  channels: HandoffChannels;
  parse: (required: { raw: unknown }) => Payload;
  senderRefused: string;
}, _optional: Record<string, never> = {}): void {
  ipcMain.handle(channels.request, (event, raw) => {
    const url = event?.senderFrame?.url;
    if (typeof url !== "string" || !isTrustedSender({ senderUrl: url })) throw new Error(senderRefused);
    const window = windows()[0];
    if (!window) return { opened: false };
    // An admin in its own window (or a minimized app) would otherwise change a screen nobody sees.
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    window.webContents.send(channels.open, parse({ raw }));
    return { opened: true };
  });
}
