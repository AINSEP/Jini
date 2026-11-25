import { useState } from "react";
import { McpUiSurfaceCard, type KitChatTranslator, type KitMcpUiSurfaceCardProps } from "../../../react/kit.js";

import { useOverflowDetection } from "./hooks/useOverflowDetection.hooks.js";
import { MessageOverflowModal } from "./MessageOverflowModal.js";
import { useMessageOverflowModal } from "./MessageOverflowModal.hooks.js";

/**
 * @file The "Show in modal" affordance for MCP-UI surfaces (owner request, chat-overflow fix
 * 2026-08-30) — see `MessageOverflowModal.tsx`'s own doc for the owner's exact wording. Wraps
 * the admin kit's `McpUiSurfaceCard` without touching it, or the chat package at all: the same
 * `RoutedA2uiSurfaceCard.tsx` pattern one file over — `hooks/use-dock-renderer-registry.hooks.ts`
 * registers THIS component under `mcp-ui` in the dock's owned registry in place of the chat library's
 * `registerMcpUiSurfaceRenderer` convenience call (which would register `McpUiSurfaceCard` itself,
 * with no seam to wrap it), and it renders the real `McpUiSurfaceCard` unchanged plus the new
 * button around it. 
 *
 * Shown only when the rendered surface genuinely overflows its own box
 * (`useOverflowDetection`, `ResizeObserver`-driven) — a button on a surface that already fits the
 * 380px dock is noise, per the owner's own framing ("if we have a UI element that we can't really
 * show ... very well"). See that hook's own doc for the one case it cannot see (a surface height-
 * capped by `McpUiHost`'s `maxHeight` whose real content overflows INSIDE its own sandboxed iframe)
 * — a real, disclosed limitation, not silently dropped.
 *
 * Clicking it MOVES the surface into `MessageOverflowModal` rather than adding a second, independent
 * copy next to it: the inline `<McpUiSurfaceCard>` unmounts (`expanded ? null : <McpUiSurfaceCard
 * .../>`) at the same instant the modal's own copy mounts, so exactly one live instance of a given
 * surface exists at any moment. An earlier version of this component mounted BOTH simultaneously
 * (identical props, so the identical resource/`sessionKey` — see that component's own doc for why
 * the URI+text pair is the real identity) — real bug, not a deliberate two-sessions design: every
 * `data-agent-element` handle `McpUiSurfaceCard`'s own `PendingSurfaceMirror` publishes is derived
 * purely from the surface's `ui://` URI, so two live copies of the same surface published the exact
 * same handle twice in the DOM — one `page.find_elements` match resolves to whichever the driver
 * happens to hit first, and worse, both copies run a REAL, separate `@mcp-ui/client` handshake
 * wired to the same `onToolCall`, so a pending confirmation could be answered from either copy,
 * genuinely executing its tool call twice. Losing the inline copy's in-progress session state on
 * expand/collapse (a filled-out form, say) is a real cost of this fix, not an oversight — accepted
 * because it is strictly safer than the double-live-session alternative it replaces: a session that
 * exists in only one place at a time cannot go stale relative to a twin the user or an agent might
 * act on instead. `@mcp-ui/client`'s `AppRenderer` owns its iframe's lifecycle end to end, and there
 * is no supported way to reparent a live sandboxed iframe across the swap, so the modal's copy
 * starts a fresh session rather than continuing the inline one's.
 */
export interface OverflowAwareMcpUiSurfaceCardProps extends KitMcpUiSurfaceCardProps {
  /** Injectable seam for overflow measurement — lets a test force the "Show in modal" button on or
   *  off without depending on `ResizeObserver`/real layout. Defaults to the real
   *  {@link useOverflowDetection}. */
  useOverflowDetectionHook?: typeof useOverflowDetection;
  /** The host's translator hook (required: a Jini component never reaches for a host hook itself). */
  useTHook: () => KitChatTranslator;
}

export function OverflowAwareMcpUiSurfaceCard({
  useOverflowDetectionHook = useOverflowDetection,
  useTHook, ...surfaceProps
}: OverflowAwareMcpUiSurfaceCardProps) {
  const t = useTHook();
  const [expanded, setExpanded] = useState(false);
  const { containerRef, isOverflowing } = useOverflowDetectionHook<HTMLDivElement>();

  return (
    <div className="jini-mcpui-surface-overflow-wrap" ref={containerRef}>
      {expanded ? null : <McpUiSurfaceCard {...surfaceProps} />}
      {isOverflowing ? (
        <button type="button" className="jini-mcpui-surface-overflow-expand" onClick={() => setExpanded(true)}>
          {t("Show in modal")}
        </button>
      ) : null}
      <MessageOverflowModal useModal={useMessageOverflowModal} useTHook={useTHook} open={expanded} title={t("Show in modal")} onClose={() => setExpanded(false)}>
        {expanded ? <McpUiSurfaceCard {...surfaceProps} /> : null}
      </MessageOverflowModal>
    </div>
  );
}
