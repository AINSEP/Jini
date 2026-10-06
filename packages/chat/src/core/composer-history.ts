/** Text-only prompt recall. Browsing owns a snapshot so incoming turns cannot move its cursor. */
export interface ComposerHistoryState {
  entries: readonly string[];
  index: number | null;
  draft: string | null;
}

export interface ComposerHistoryStoragePort {
  read: (required: { scope: string }, optional: {}) => Promise<readonly string[]>;
  write: (required: { scope: string; entries: readonly string[] }, optional: {}) => Promise<void>;
}

export interface ComposerHistoryKeyInput {
  key: string;
  text: string;
  selectionStart: number;
  selectionEnd: number;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  isComposing?: boolean;
  popupOpen?: boolean;
  /** A DOM host can refine logical newline boundaries with measured soft-wrap boundaries. */
  firstLine?: boolean;
  lastLine?: boolean;
}

export function normalizeComposerHistory(
  { entries }: { entries: readonly string[] },
  { cap = 100 }: { cap?: number } = {},
): string[] {
  const result: string[] = [];
  for (const text of entries) {
    // Blank/attachment-only turns are not useful prompts; meaningful whitespace stays exact.
    if (text.trim() && text !== result[result.length - 1]) result.push(text);
  }
  return result.slice(-Math.max(1, Math.floor(cap)));
}

export function mergeComposerHistory(
  { recent, current }: { recent: readonly string[]; current: readonly string[] },
  { cap = 100 }: { cap?: number } = {},
): string[] {
  const left = normalizeComposerHistory({ entries: recent }, { cap });
  const right = normalizeComposerHistory({ entries: current }, { cap });
  // A mounted conversation is usually already the recent list's suffix. Do not append its
  // entire transcript again on every streamed render; preserve nonconsecutive repetitions.
  let overlap = Math.min(left.length, right.length);
  while (overlap > 0 && !right.slice(0, overlap).every((text, i) => text === left[left.length - overlap + i])) overlap -= 1;
  return normalizeComposerHistory({ entries: [...left, ...right.slice(overlap)] }, { cap });
}

export function createComposerHistoryState(
  _required: {},
  _optional: {} = {},
): ComposerHistoryState {
  return { entries: [], index: null, draft: null };
}

export function composerHistoryKeyAction(
  input: ComposerHistoryKeyInput,
  _optional: {} = {},
): 'previous' | 'next' | 'restore' | null {
  if (input.shiftKey || input.ctrlKey || input.altKey || input.metaKey || input.isComposing || input.popupOpen) return null;
  if (input.key === 'Escape') return 'restore';
  const start = Math.min(input.selectionStart, input.selectionEnd);
  const end = Math.max(input.selectionStart, input.selectionEnd);
  if (input.text.slice(start, end).includes('\n')) return null;
  const firstLine = !input.text.slice(0, end).includes('\n') && input.firstLine !== false;
  const lastLine = !input.text.slice(start).includes('\n') && input.lastLine !== false;
  if (input.key === 'ArrowUp' && firstLine) return 'previous';
  if (input.key === 'ArrowDown' && lastLine) return 'next';
  return null;
}

export function transitionComposerHistory(
  { state, action, text, entries }: {
    state: ComposerHistoryState;
    action: 'previous' | 'next' | 'restore' | 'edit' | 'reset';
    text: string;
    entries: readonly string[];
  },
  _optional: {} = {},
): { state: ComposerHistoryState; text: string; handled: boolean } {
  if (action === 'edit' || action === 'reset') {
    return { state: createComposerHistoryState({}), text, handled: false };
  }
  if (state.index === null) {
    if (action !== 'previous' || entries.length === 0) return { state, text, handled: false };
    const snapshot = [...entries];
    const index = snapshot.length - 1;
    return { state: { entries: snapshot, index, draft: text }, text: snapshot[index]!, handled: true };
  }
  if (action === 'restore' || (action === 'next' && state.index === state.entries.length - 1)) {
    return { state: createComposerHistoryState({}), text: state.draft ?? '', handled: true };
  }
  const index = action === 'previous' ? Math.max(0, state.index - 1) : state.index + 1;
  return { state: { ...state, index }, text: state.entries[index]!, handled: true };
}
