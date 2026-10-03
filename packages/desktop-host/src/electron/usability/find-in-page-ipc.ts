/** Mirrors the Electron options used for browser-style search: omitting matchCase keeps
 * searches case-insensitive. findNext retains Electron's counterintuitive convention:
 * true starts a NEW search session for a fresh query; false steps within the current session. */
/**
 * Guest webviews can search directly from their renderer; the host window's top-level page
 * needs main-process webContents, so only that surface uses these IPC handlers.
 * Resolve the sender's window for each call rather than retaining a tracked window reference;
 * this permits one global registration after readiness without window-scoped handler state.
 */
export interface FindInPageQuery { text: string; forward: boolean; findNext: boolean }
/** Electron reports activeMatchOrdinal as 1-based and matches as the total count, including
 * zero when nothing matched; consumers must preserve those display semantics. */
export interface FindInPageResult { activeMatchOrdinal: number; matches: number }
export interface FindWebContentsPort {
  findInPage(args: { text: string }, options?: { forward?: boolean; findNext?: boolean }): unknown;
  stopFindInPage(args: { action: "clearSelection" }): void;
}
export interface FindWindowLookup<Sender = unknown> {
  // Lookup can return null for a destroyed window or a guest rather than a top-level sender.
  fromWebContents(args: { sender: Sender }): { webContents: FindWebContentsPort } | null;
}
export interface FindIpcPort<Sender = unknown> {
  handle(args: { channel: string; listener: (args: { event: { sender: Sender }; query: FindInPageQuery }) => unknown }): unknown;
  removeHandler?(args: { channel: string }): unknown;
}
// Invocation is fire-and-forget: results arrive later through found-in-page, not the return value.
/** Register top-level searches against the calling window. Returns an IPC disposer. */
export function registerFindInPageIpc<Sender>({ ipcMain, browserWindow, channels }: {
  ipcMain: FindIpcPort<Sender>; browserWindow: FindWindowLookup<Sender>;
  channels: { find: string; stop: string };
}): () => void {
  ipcMain.handle({ channel: channels.find, listener: ({ event, query }) => {
    browserWindow.fromWebContents({ sender: event.sender })?.webContents.findInPage({ text: query.text }, { forward: query.forward, findNext: query.findNext });
  } });
  ipcMain.handle({ channel: channels.stop, listener: ({ event }) => {
    browserWindow.fromWebContents({ sender: event.sender })?.webContents.stopFindInPage({ action: "clearSelection" });
  } });
  return () => { ipcMain.removeHandler?.({ channel: channels.find }); ipcMain.removeHandler?.({ channel: channels.stop }); };
}
export interface FindResultSource {
  // Narrow to the one event used here rather than forcing fakes to implement all Electron overloads.
  on(args: { event: "found-in-page"; listener: (args: { result: FindInPageResult }) => void }): unknown;
  removeListener?(args: { event: "found-in-page"; listener: (args: { result: FindInPageResult }) => void }): unknown;
  send(args: { channel: string; payload: FindInPageResult }): void;
}
/** Relay only match counts from a live window, and return an event disposer. */
export function relayFindResults({ window, resultChannel }: {
  window: { webContents: FindResultSource; isDestroyed(): boolean }; resultChannel: string;
}): () => void {
  const listener = ({ result }: { result: FindInPageResult }): void => {
    if (window.isDestroyed()) return;
    window.webContents.send({ channel: resultChannel, payload: { activeMatchOrdinal: result.activeMatchOrdinal, matches: result.matches } });
  };
  window.webContents.on({ event: "found-in-page", listener });
  return () => { window.webContents.removeListener?.({ event: "found-in-page", listener }); };
}
