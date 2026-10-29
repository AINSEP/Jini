/** Text-only prompt recall. Browsing owns a snapshot so incoming turns cannot move its cursor. */
export interface ComposerHistoryState {
  entries: readonly string[];
  index: number | null;
  draft: string | null;
}

export interface ComposerHistoryStoragePort {
  read: (required: { scope: string }, optional: { cap?: number }) => Promise<readonly string[]>;
  write: (required: { scope: string; entries: readonly string[] }, optional: { cap?: number }) => Promise<void>;
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

type ComposerHistoryKeyAction = 'previous' | 'next' | 'restore';
type ComposerHistoryTransition = { state: ComposerHistoryState; text: string; handled: boolean };

function hasModifierOrPopup({ input }: { input: ComposerHistoryKeyInput }, _optional: {} = {}): boolean {
  const modified = input.shiftKey || input.ctrlKey || input.altKey || input.metaKey;
  return Boolean(modified || input.isComposing || input.popupOpen);
}

/**
 * Whether the selection sits on the first/last line. A selection spanning a newline is on
 * neither, because text[0, end) and text[start, ∞) both contain the selected newline.
 */
function caretBoundaries(
  { input }: { input: ComposerHistoryKeyInput },
  _optional: {} = {},
): { firstLine: boolean; lastLine: boolean } {
  const start = Math.min(input.selectionStart, input.selectionEnd);
  const end = Math.max(input.selectionStart, input.selectionEnd);
  return {
    firstLine: !input.text.slice(0, end).includes('\n') && input.firstLine !== false,
    lastLine: !input.text.slice(start).includes('\n') && input.lastLine !== false,
  };
}

export function composerHistoryKeyAction(
  input: ComposerHistoryKeyInput,
  _optional: {} = {},
): ComposerHistoryKeyAction | null {
  if (hasModifierOrPopup({ input })) return null;
  if (input.key === 'Escape') return 'restore';
  const lines = caretBoundaries({ input });
  if (input.key === 'ArrowUp' && lines.firstLine) return 'previous';
  if (input.key === 'ArrowDown' && lines.lastLine) return 'next';
  return null;
}

function startBrowsing(
  { state, action, text, entries }: { state: ComposerHistoryState; action: string; text: string; entries: readonly string[] },
  _optional: {} = {},
): ComposerHistoryTransition {
  if (action !== 'previous' || entries.length === 0) return { state, text, handled: false };
  const snapshot = [...entries];
  const index = snapshot.length - 1;
  return { state: { entries: snapshot, index, draft: text }, text: snapshot[index]!, handled: true };
}

export function transitionComposerHistory(
  { state, action, text, entries }: {
    state: ComposerHistoryState;
    action: ComposerHistoryKeyAction | 'edit' | 'reset';
    text: string;
    entries: readonly string[];
  },
  _optional: {} = {},
): ComposerHistoryTransition {
  if (action === 'edit' || action === 'reset') {
    return { state: createComposerHistoryState({}), text, handled: false };
  }
  if (state.index === null) return startBrowsing({ state, action, text, entries });
  if (action === 'restore' || (action === 'next' && state.index === state.entries.length - 1)) {
    return { state: createComposerHistoryState({}), text: state.draft ?? '', handled: true };
  }
  const index = action === 'previous' ? Math.max(0, state.index - 1) : state.index + 1;
  return { state: { ...state, index }, text: state.entries[index]!, handled: true };
}
