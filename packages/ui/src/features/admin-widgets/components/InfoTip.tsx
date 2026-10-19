import { useId, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { agentHandle } from "@jini-ai/agentic";

import { useInfoTip } from "./InfoTip.hooks.js";
import { infoTipBubbleStyle, infoTipLines } from "./InfoTip.rules.js";

/**
 * Native title tooltips have an OS-dependent hover delay, inconsistent screen-reader exposure
 * and no touch visibility. Hover/focus opens this affordance; Escape dismisses without moving
 * focus, which onBlur alone cannot do.
 * A body portal escapes overflow:hidden/scrolling ancestors: z-index cannot rescue an absolutely
 * positioned descendant from clipping. Inside a modal <dialog> it portals into that dialog
 * instead, because the dialog's top layer covers everything in body. Measured viewport coordinates position it above by
 * preference, with the hook's headroom guard choosing below near the viewport's top; near a side
 * edge (or a host panel marked `data-jini-tip-bounds`) it shifts by its real width, never squeezes.
 * Keep state and DOM measurement in the injectable hook so rendering can use fixed fake state.
 * Touch has no hover, so a tap (or Enter/Space) pins the tip open until a second tap, an outside
 * tap, blur or Escape; a hover-opened tip still closes when the pointer leaves.
 */
export interface InfoTipProps {
  /** The explanation the bubble shows; newlines separate lines, and "• " lines show as a hanging list. */
  label: string;
  /**
   * Short accessible name for the icon ("About subagents"). Omitted, the icon is named by `label`
   * itself, the original contract. Given, `label` becomes the icon's description instead, so a
   * screen reader hears a short name plus the full text rather than one long name.
   */
  triggerLabel?: string | undefined;
  /**
   * Id for an always-present hidden copy of `label`, so the control the tip explains (a checkbox,
   * a field) can point its own `aria-describedby` at it; the icon references it too.
   */
  descriptionId?: string | undefined;
  /** Preferred side, or inline help that reserves space instead of covering nearby controls. */
  placement?: "top" | "bottom" | "inline" | undefined;
  useTip?: typeof useInfoTip | undefined;
  // Agent clicks toggle the tip like a tap, so the handle advertises button semantics.
  // Omission leaves existing markup untagged.
  agentHandle?: string | undefined;
  /** What the trigger shows instead of the default ⓘ, e.g. a status icon whose meaning the bubble
   *  explains. Decorative: the trigger is still named by `triggerLabel`/`label`. */
  icon?: ReactNode | undefined;
}

/** Focus/hover tooltip that portals outside clipping ancestors; Escape dismisses in place. */
export function InfoTip({ label, triggerLabel, descriptionId, placement: preferredPlacement, useTip = useInfoTip, agentHandle: handle, icon }: InfoTipProps) {
  const { open, placement, coords, iconRef, bubbleRef, show, hide, leave, toggle, handleIconKeyDown } = useTip({}, { placement: preferredPlacement === "inline" ? undefined : preferredPlacement });
  const autoId = useId();
  const name = triggerLabel ?? label;
  // With no short name the icon is already named by the full text; describing it again would
  // make a screen reader read it twice.
  const textId = descriptionId ?? (triggerLabel ? autoId : undefined);
  const describedBy = triggerLabel ? textId : undefined;

  return (
    <span className={preferredPlacement === "inline" ? "info-tip info-tip--inline" : "info-tip"}>
      <span
        ref={iconRef}
        className={icon ? "info-tip-icon info-tip-icon--custom" : "info-tip-icon"}
        role="button"
        tabIndex={0}
        aria-label={name}
        aria-expanded={open}
        {...(describedBy ? { "aria-describedby": describedBy } : {})}
        onMouseEnter={show}
        onMouseLeave={leave}
        onFocus={show}
        onBlur={hide}
        onClick={toggle}
        onKeyDown={handleIconKeyDown}
        {...(handle ? agentHandle({ handle: handle }, { role: "button", label: name }) : {})}
      >
        {icon ?? "ⓘ"}
      </span>
      {textId ? <span id={textId} hidden>{label}</span> : null}
      {open && preferredPlacement === "inline" ? <span className="info-tip-inline-copy" aria-hidden="true">{label}</span> : open
        ? createPortal(
            <span
              ref={bubbleRef}
              className={placement === "below" ? "info-tip-bubble info-tip-bubble-below" : "info-tip-bubble"}
              role="presentation"
              aria-hidden="true"
              style={{ ...infoTipBubbleStyle(coords), whiteSpace: "pre-line" }}
            >
              {/* Keep the label's text separators; flex layout alone loses them from textContent. */}
              {infoTipLines(label)?.map((line, index, lines) => line.bullet
                ? <span key={index} className="info-tip-bullet"><span aria-hidden="true">•</span>{" "}<span>{line.text}</span>{index < lines.length - 1 ? "\n" : null}</span>
                : <span key={index} className="info-tip-line">{line.text}{index < lines.length - 1 ? "\n" : null}</span>) ?? label}
            </span>,
            // A modal <dialog> sits in the browser's top layer, above anything portaled to body.
            iconRef.current?.closest("dialog") ?? document.body
          )
        : null}
    </span>
  );
}
