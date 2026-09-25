/**
 * Pure types for the folder-path-drop feature. No React, no DOM globals.
 */
import type { FolderPathDropPort } from './ports.js';

/** Exactly what `captureFolderPathDrop` reads off a drop, so a React `DragEvent` and a plain object both fit. */
export interface FolderPathDropEvent {
  readonly dataTransfer: DataTransfer;
  preventDefault(): void;
  stopPropagation(): void;
}

/** Where recovered paths go as text. `@jini-ai/chat`'s `ChatPaneComposerHandle` fits structurally. */
export interface FolderPathDropInsertTarget {
  insertText(text: string): void;
}

/** A React `RefObject`-shaped handle to the insert target, without importing React. `null` before it mounts. */
export interface FolderPathDropInsertTargetRef {
  readonly current: FolderPathDropInsertTarget | null;
}

export interface CaptureFolderPathDropInput {
  /** The raw drop, from a CAPTURE-phase listener (see `rules.ts`'s header for why). */
  readonly event: FolderPathDropEvent;
  /** `null`/`undefined` when the host has no path lookup: every drop then passes through untouched. */
  readonly port: FolderPathDropPort | null | undefined;
  /** A folder drop with `current === null` is still swallowed; nothing is inserted. */
  readonly composer: FolderPathDropInsertTargetRef;
}
