import { useScrollJump } from "./ScrollJump.hooks.js";

export interface ScrollJumpButtonsProps {
  /** The scrolling element the buttons control (an admin shell's `<main>`); `null` renders nothing. */
  container: HTMLElement | null;
  /** Accessible names, already translated by the host. */
  labels?: { toTop: string; toBottom: string } | undefined;
  useJump?: typeof useScrollJump | undefined;
}

const DEFAULT_LABELS = { toTop: "Scroll to top", toBottom: "Scroll to bottom" };

/** An edge button that does not apply keeps its slot (CSS `visibility: hidden`, which also drops it
 * from the tab order), so the other button never slides under the pointer that just clicked. */
const offProps = (show: boolean) => (show ? {} : { "data-off": "" });

/**
 * A quiet ↑/↓ pair for long pages. Hidden on short pages; ↑ hides at the top and ↓ at the bottom.
 * Position it with the host's CSS (`--jini-scroll-jump-right`/`-bottom`/`-direction`) so it
 * clears that host's own floating controls.
 */
export function ScrollJumpButtons({ container, labels = DEFAULT_LABELS, useJump = useScrollJump }: ScrollJumpButtonsProps) {
  const { showTop, showBottom, jump } = useJump({ container });
  if (!showTop && !showBottom) return null;
  return (
    <div className="jini-scroll-jump">
      <button type="button" className="jini-scroll-jump__btn" {...offProps(showTop)} aria-label={labels.toTop} title={labels.toTop} onClick={() => jump("top")}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m18 15-6-6-6 6" />
        </svg>
      </button>
      <button type="button" className="jini-scroll-jump__btn" {...offProps(showBottom)} aria-label={labels.toBottom} title={labels.toBottom} onClick={() => jump("bottom")}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
    </div>
  );
}
