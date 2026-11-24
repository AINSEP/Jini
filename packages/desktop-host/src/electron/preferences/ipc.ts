/** A trusted read/write IPC handler pair for one preference; the host owns channels and storage. */

/** The `ipcMain` slice the pair needs; `removeHandler` is optional for minimal fakes. */
export interface PreferenceIpcMain<Sender, T> {
  handle: (channel: string, handler: (event: { sender: Sender }, value?: unknown) => T) => void;
  removeHandler?: (channel: string) => void;
}

/**
 * Register read and write handlers that refuse untrusted senders before touching storage, and parse
 * the written value before saving. `read`/`write` run only for an authorized (and, for writes,
 * valid) request, so a host may resolve its storage lazily inside them.
 * @returns Teardown that removes both handlers. O(1) registration.
 */
export function registerPreferenceIpc<Sender, T>({ ipcMain, channels, allowed, untrustedError, parse, read, write }: {
  ipcMain: PreferenceIpcMain<Sender, T>;
  channels: { read: string; write: string };
  allowed: (args: { sender: Sender }) => boolean;
  /** Error message thrown to a refused sender. */
  untrustedError: string;
  /** Answer the accepted value, or throw the host's own validation error. */
  parse: (args: { value: unknown }) => T;
  read: () => T;
  write: (args: { value: T }) => T;
}, _optional = {}): () => void {
  const trusted = ({ sender }: { sender: Sender }) => { if (!allowed({ sender })) throw new Error(untrustedError); };
  ipcMain.handle(channels.read, ({ sender }) => { trusted({ sender }); return read(); });
  ipcMain.handle(channels.write, ({ sender }, value) => {
    trusted({ sender });
    return write({ value: parse({ value }) });
  });
  return () => {
    ipcMain.removeHandler?.(channels.read);
    ipcMain.removeHandler?.(channels.write);
  };
}
