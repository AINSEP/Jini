import { agentHandle } from "@jini-ai/agentic";
import { useSeeMoreClamp } from "./SeeMore.hooks.js";

/**
 * Clamp the rendered region instead of slicing children: hidden text must stay in the DOM so
 * browser find and screen readers can still reach it. Truncating the string loses that content.
 * State and DOM measurement live in the separate hook, keeping presentation independently
 * renderable with an injected measurement seam and no real layout engine or ResizeObserver.
 */
export interface SeeMoreProps {
  children: React.ReactNode;
  lines?: number | undefined;
  moreLabel?: string | undefined;
  lessLabel?: string | undefined;
  className?: string | undefined;
  /** Keep caller typography on the text region; clamp mechanics should not dictate color or line-height. */
  textClassName?: string | undefined;
  toggleClassName?: string | undefined;
  /** Distinguish repeated toggles in a screen reader's button list; expanded/controls are always set. */
  toggleAriaLabel?: string | undefined;
  /** Supply a fake measurement hook when rendering without real scrollHeight/clientHeight layout. */
  useClamp?: typeof useSeeMoreClamp | undefined;
  /** The handle identifies a rendered toggle only; fitting content has no control to address. */
  agentHandle?: string | undefined;
}

const DEFAULT_LINES = 2;

export interface SeeMoreView {
  wrapperClassName: string;
  textClassName: string;
  toggleClassName: string;
  toggleLabel: string;
}

// Presentation depends only on props and expanded state, so this decision needs no React render.
export function resolveSeeMoreView({
  expanded,
}: { expanded: boolean }, {
  moreLabel = "See more",
  lessLabel = "See less",
  className,
  textClassName,
  toggleClassName,
}: {
  moreLabel?: string | undefined;
  lessLabel?: string | undefined;
  className?: string | undefined;
  textClassName?: string | undefined;
  toggleClassName?: string | undefined;
} = {}): SeeMoreView {
  return {
    wrapperClassName: className ? `see-more ${className}` : "see-more",
    textClassName: `see-more-text${expanded ? " is-expanded" : ""}${textClassName ? ` ${textClassName}` : ""}`,
    toggleClassName: toggleClassName ? `see-more-toggle ${toggleClassName}` : "see-more-toggle",
    toggleLabel: expanded ? lessLabel : moreLabel,
  };
}

/** Clamps overflowing text and exposes an accessible expand/collapse toggle. Labels are host-owned. */
export function SeeMore({ useClamp = useSeeMoreClamp, agentHandle: handle, ...props }: SeeMoreProps) {
  const { children, lines = DEFAULT_LINES, moreLabel, lessLabel, className, textClassName, toggleClassName, toggleAriaLabel } = props;

  const { expanded, setExpanded, overflows, textRef, regionId, lineCount } = useClamp({ lines, children });
  const view = resolveSeeMoreView({ expanded }, { moreLabel, lessLabel, className, textClassName, toggleClassName });

  return (
    <div className={view.wrapperClassName}>
      <div
        ref={textRef}
        id={regionId}
        className={view.textClassName}
        // The line count rides a custom property rather than a class-per-N (`.see-more-text--3`),
        // so `lines` can be any integer a caller needs without this file growing a rule for each.
        style={{ "--see-more-lines": lineCount } as React.CSSProperties}
      >
        {children}
      </div>
      {overflows ? (
        <button
          type="button"
          className={view.toggleClassName}
          aria-expanded={expanded}
          aria-controls={regionId}
          aria-label={toggleAriaLabel}
          onClick={() => setExpanded((current) => !current)}
          {...(handle ? agentHandle({ handle: handle }, { role: "button", label: toggleAriaLabel ?? view.toggleLabel }) : {})}
        >
          {view.toggleLabel}
        </button>
      ) : null}
    </div>
  );
}
