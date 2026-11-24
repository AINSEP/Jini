import { useInfoTip } from "../../../react/kit.js";
import { useEffect, useRef, type KeyboardEvent } from "react";

/**
 * @file The tip controller behind a linked agent plugin's padlock (`AgentPluginLinkedLock`, owner
 * 2026-10-25). It is the shared `InfoTip`'s own `useInfoTip`, with one change: pressing the padlock
 * follows it to the Plugins page instead of pinning the tip. Hover and focus still explain.
 *
 * Touch has no hover, so a tap on a closed tip opens and pins it first, and the next tap follows.
 * Whether the tip was open is read at `pointerdown`: mobile browsers fire their emulated
 * `mouseenter` (which opens the tip) between that and the `click`, and iOS swallows the first
 * tap's `click` altogether once that hover opened something — so either way one tap explains and
 * the next one follows.
 */
export function linkedLockTip({ onFollow }: { onFollow: () => void }): typeof useInfoTip {
  return function useLinkedLockTip(input, options) {
    const tip = useInfoTip(input, options);
    const openRef = useRef(tip.open);
    // Whether the tip was open when the last touch landed; `null` after a mouse/pen press (or none yet).
    const openAtTouch = useRef<boolean | null>(null);
    const { iconRef } = tip;
    useEffect(() => {
      openRef.current = tip.open;
    });
    useEffect(() => {
      const icon = iconRef.current;
      const note = (event: PointerEvent) => {
        openAtTouch.current = event.pointerType === "touch" ? openRef.current : null;
      };
      icon?.addEventListener("pointerdown", note);
      return () => icon?.removeEventListener("pointerdown", note);
    }, [iconRef]);
    const press = () => {
      if (openAtTouch.current === false) {
        openAtTouch.current = null;
        tip.toggle();
        return;
      }
      onFollow();
    };
    const handleIconKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
      if (event.key !== "Enter" && event.key !== " ") {
        tip.handleIconKeyDown(event);
        return;
      }
      event.preventDefault();
      onFollow();
    };
    return { ...tip, toggle: press, handleIconKeyDown };
  };
}
