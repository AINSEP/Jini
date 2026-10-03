import { createPortal } from "react-dom";
import { agentHandle } from "@jini-ai/agentic";

import { useInfoTip } from "./InfoTip.hooks.js";

/**
 * Native title tooltips have an OS-dependent hover delay, inconsistent screen-reader exposure
 * and no touch visibility. Hover/focus opens this affordance; Escape dismisses without moving
 * focus, which onBlur alone cannot do.
 * A body portal escapes overflow:hidden/scrolling ancestors: z-index cannot rescue an absolutely
 * positioned descendant from clipping. Measured viewport coordinates position it above by
 * preference, with the hook's headroom guard choosing below near the viewport's top.
 * Keep state and DOM measurement in the injectable hook so rendering can use fixed fake state.
 */
export interface InfoTipProps {
  label: string;
  useTip?: typeof useInfoTip | undefined;
  // Agent clicks focus the icon and open the tip, so the handle advertises button semantics
  // even though the icon has no onClick handler. Omission leaves existing markup untagged.
  agentHandle?: string | undefined;
}

/** Focus/hover tooltip that portals outside clipping ancestors; Escape dismisses in place. */
export function InfoTip({ label, useTip = useInfoTip, agentHandle: handle }: InfoTipProps) {
  const { open, placement, coords, iconRef, show, hide, handleIconKeyDown } = useTip();

  return (
    <span className="info-tip">
      <span
        ref={iconRef}
        className="info-tip-icon"
        tabIndex={0}
        aria-label={label}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onKeyDown={handleIconKeyDown}
        {...(handle ? agentHandle({ handle: handle }, { role: "button", label }) : {})}
      >
        ⓘ
      </span>
      {open
        ? createPortal(
            <span
              className={placement === "below" ? "info-tip-bubble info-tip-bubble-below" : "info-tip-bubble"}
              role="presentation"
              aria-hidden="true"
              style={{ top: coords.top, left: coords.left }}
            >
              {label}
            </span>,
            document.body
          )
        : null}
    </span>
  );
}
