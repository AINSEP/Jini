/**
 * Native message boxes the updater and the desktop shell show: a plain notice, the "Update ready"
 * prompt and the "close the other copies" explanation. Electron's `dialog` and `BrowserWindow`
 * arrive as ports, so every rule here runs under plain node with fakes. Every word (labels, titles,
 * details) is host copy passed in; this module owns only parenting, button order and answers.
 */
import type { UpdateNotice } from './update-check-now.js';

/** The slice of Electron's `MessageBoxOptions` these boxes set; Electron's own type accepts it. */
export interface NativeMessageBoxOptions {
  type?: 'none' | 'info' | 'error' | 'question' | 'warning';
  message: string;
  detail?: string;
  buttons?: string[];
  defaultId?: number;
  cancelId?: number;
}

/** The slice of Electron's `dialog` these boxes use; Electron's own `dialog` satisfies it. */
export interface NativeDialogPort<W> {
  showMessageBox(window: W, options: NativeMessageBoxOptions): Promise<{ response: number }>;
  showMessageBox(options: NativeMessageBoxOptions): Promise<{ response: number }>;
}

/** The slice of Electron's `BrowserWindow` statics these boxes use. */
export interface WindowListPort<W> {
  getFocusedWindow(): W | null;
  getAllWindows(): W[];
}

/** Host wording for the "Update ready" prompt. */
export interface UpdateReadyPromptCopy {
  message: string;
  detail: (args: { version: string }) => string;
  restartLabel: string;
  laterLabel: string;
}

/** Host wording for "close the other copies first" (the host owns pluralization). */
export interface OthersOpenCopy {
  message: string;
  detail: (args: { count: number }) => string;
}

/** "Update ready": Restart is button 0, Escape/close lands on Later. */
export function updateReadyPromptOptions({ copy, version }: { copy: UpdateReadyPromptCopy; version: string }, _optionalArgs = {}): NativeMessageBoxOptions {
  return {
    type: 'info',
    buttons: [copy.restartLabel, copy.laterLabel],
    defaultId: 0,
    cancelId: 1,
    message: copy.message,
    detail: copy.detail({ version }),
  };
}

/** Restart to update was chosen while other copies of the app are open. */
export function othersOpenOptions({ copy, count }: { copy: OthersOpenCopy; count: number }, _optionalArgs = {}): NativeMessageBoxOptions {
  return { type: 'info', message: copy.message, detail: copy.detail({ count }) };
}

/**
 * A box as a sheet on the focused window, else the first window, else app-modal when none is open.
 * @returns The native box's answer. @complexity O(n) open windows.
 */
export function showOnFocusedWindow<W>({ dialog, windows, options }: {
  dialog: NativeDialogPort<W>; windows: WindowListPort<W>; options: NativeMessageBoxOptions;
}, _optionalArgs = {}): Promise<{ response: number }> {
  const parent = windows.getFocusedWindow() ?? windows.getAllWindows()[0];
  return parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options);
}

/** One native message box with a single acknowledge button (`okLabel`), not awaited. */
export function showNativeNotice<W>({ dialog, windows, notice, okLabel }: {
  dialog: NativeDialogPort<W>; windows: WindowListPort<W>; notice: UpdateNotice; okLabel: string;
}, _optionalArgs = {}): void {
  const { type, message, detail } = notice;
  void showOnFocusedWindow({ dialog, windows, options: { type, message, detail, buttons: [okLabel] } });
}

/** The "Update ready" prompt, as a sheet on the focused window. Resolves `true` for Restart. */
export async function promptUpdateReady<W>({ dialog, windows, automaticUpdates, version, copy }: {
  dialog: NativeDialogPort<W>; windows: WindowListPort<W>; automaticUpdates: () => boolean;
  version: string; copy: UpdateReadyPromptCopy;
}, _optionalArgs = {}): Promise<boolean> {
  // The download event may already have queued its prompt when the checkbox is turned off.
  if (!automaticUpdates()) return false;
  const { response } = await showOnFocusedWindow({ dialog, windows, options: updateReadyPromptOptions({ copy, version }) });
  return response === 0;
}

/** Restart to update was chosen while other copies of the app are open. Never parented. */
export function explainOthersOpen<W>({ dialog, count, copy }: {
  dialog: NativeDialogPort<W>; count: number; copy: OthersOpenCopy;
}, _optionalArgs = {}): void {
  void dialog.showMessageBox(othersOpenOptions({ copy, count }));
}
