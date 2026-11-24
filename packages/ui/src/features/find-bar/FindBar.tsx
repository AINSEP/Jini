/** The find bar's view of a find-in-page state machine; the host's own hook produces it. */
export interface FindBarModel {
  open: boolean;
  query: string;
  /** Text for the counter, e.g. "2 of 5"; the host formats it. */
  countLabel: string;
  inputRef: (node: HTMLInputElement | null) => void;
  setQuery: (input: { text: string }) => void;
  next: () => void;
  previous: () => void;
  close: () => void;
}

/** Visible and spoken words; product copy comes from the host. `field` is the input's placeholder and accessible name. */
export interface FindBarLabels {
  field: string;
  previous: string;
  previousTip: string;
  next: string;
  nextTip: string;
  close: string;
  closeTip: string;
}

export interface FindBarProps {
  find: FindBarModel;
  labels: FindBarLabels;
}

/**
 * Cmd+F's own bar: a query input, the "N of M" counter, previous/next, and a close button that
 * stops the search and clears its highlights. Meant to stay mounted at the host's root, hidden with a
 * plain early return rather than being conditionally rendered out of the tree — the input DOM node
 * only exists while `find.open`, so its `inputRef` has nothing to attach to when closed either way,
 * and there is no state here worth preserving across a close (the host's find hook's `close` already
 * resets it).
 *
 * Floats over whichever surface is on screen, top right, the same corner Chrome puts its own in
 * (the host's stylesheet places it through the `jini-findbar*` classes).
 */
export function FindBar({ find, labels }: FindBarProps) {
  if (!find.open) return null;
  return (
    <div className="jini-findbar" role="search">
      <input
        ref={find.inputRef}
        type="text"
        className="jini-findbar__input"
        value={find.query}
        onChange={(event) => find.setQuery({ text: event.target.value })}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            find.close();
            return;
          }
          if (event.key === 'Enter') {
            event.preventDefault();
            if (event.shiftKey) find.previous();
            else find.next();
          }
        }}
        placeholder={labels.field}
        aria-label={labels.field}
      />
      <span className="jini-findbar__count" aria-live="polite">{find.countLabel}</span>
      <button
        type="button"
        className="jini-findbar__act"
        onClick={find.previous}
        disabled={find.query === ''}
        title={labels.previousTip}
        aria-label={labels.previous}
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <path d="M4 10l4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        type="button"
        className="jini-findbar__act"
        onClick={find.next}
        disabled={find.query === ''}
        title={labels.nextTip}
        aria-label={labels.next}
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button type="button" className="jini-findbar__act jini-findbar__close" onClick={find.close} title={labels.closeTip} aria-label={labels.close}>
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <path d="M6 6l8 8M14 6l-8 8" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
