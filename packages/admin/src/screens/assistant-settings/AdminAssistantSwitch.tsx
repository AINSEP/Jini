import type { ComponentType } from "react";
import { agentHandle } from "@jini-ai/core/agent-handles";
import type { InfoTipProps } from "../../react/kit.js";
import { AssistantToggleRow } from "./AssistantToggleRow.js";
import type { useAdminAssistantSwitch } from "./use-admin-assistant-switch.hooks.js";

/**
 * Opens or closes the admin's own assistant dock — the same thing the floating action button does.
 *
 * ## Why this exists when a FAB already does it
 *
 * The FAB is a single 56px circle pinned to the bottom-right corner, and it has a history of not
 * being where the operator expects it. If it is ever off-screen, obscured, or simply not noticed,
 * the admin assistant becomes unreachable with no other affordance anywhere in the product. This is
 * the discoverable, keyboard-reachable fallback: a labelled control on the page that is *about* the
 * assistant, which is where someone looking for it would go.
 *
 * Deliberately NOT a persisted setting, unlike the public-site switch directly above it. The admin
 * assistant is always available to a signed-in administrator (see that switch's own copy) — there is
 * nothing to enable. This reflects and drives panel visibility for the current session only, which
 * is why it reads its value live rather than from `settings`. State lives in
 * `use-admin-assistant-switch.hooks.ts`.
 */
export interface AdminAssistantSwitchProps {
  /**
   * Dependency injection seam for tests — the same convention `Posts.tsx`'s `usePostsHook` uses.
   * Defaulted to the real hook, so production callers pass nothing — that was the host-side default;
   * in this package it is REQUIRED instead, and the host binds `useAdminAssistantSwitch` from this folder.
   */
  useAdminAssistantSwitchHook: typeof useAdminAssistantSwitch;
  /** `AiAssistant`'s own `t`, threaded rather than read here via `useAdminLocale()` directly — see
   *  that component's own comment for why. Required: its only caller always passes one, so the
   *  English-passthrough default it used to carry never applied. */
  t: (key: string) => string;
  /** The host's ⓘ widget. */
  InfoTip: ComponentType<InfoTipProps>;
}

export function AdminAssistantSwitch(props: AdminAssistantSwitchProps) {
  const { t, InfoTip } = props;
  const { open, setOpen } = props.useAdminAssistantSwitchHook();

  // No `.notice` wrapper, matching the Visitor tab's switch: this screen's `--page-flow` block
  // flattens the shell's card chrome so each panel reads as one form on the page's own background.
  // The two inline explainer paragraphs were removed (owner, 2026-10-09): the label says what it
  // does, and the ⓘ carries the one sentence that is still useful.
  return (
    <div className="jini-assistant-switch">
      <AssistantToggleRow t={t} InfoTip={InfoTip} label={t("Open the assistant panel")}
        info={t("Shows or hides the assistant panel in this admin.")}
        checked={open} onChange={(open) => setOpen({ open })}
        inputProps={agentHandle({ handle: "ai-assistant-admin-dock-toggle" }, { role: "field", label: "Open the assistant panel" })} />
    </div>
  );
}
