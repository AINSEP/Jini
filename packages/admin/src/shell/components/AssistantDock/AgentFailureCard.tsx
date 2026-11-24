import { useMemo } from "react";
import type { formatUserFacingError as coreFormatUserFacingError } from "@jini-ai/core";
import { ErrorNotice, type ExtEventRenderProps, type KitChatTranslator } from "../../../react/kit.js";
import type { useAgentFailureCard } from "./AgentFailureCard.hooks.js";

/** Product copy the host supplies: its secret-redaction patterns for the formatted failure. */
export type AgentFailureRedactionOptions = Parameters<typeof coreFormatUserFacingError>[1];

export function AgentFailureCard({ useTHook, useAgentFailureCardHook, formatUserFacingError, redactionOptions, ...props }: (ExtEventRenderProps) & {
  /** The host's chat translator hook (the kit chat `useT`); also handed to the failure hook. */
  useTHook: () => KitChatTranslator;
  useAgentFailureCardHook: typeof useAgentFailureCard;
  /** The host's failure formatter (core's `formatUserFacingError`): redacts with `redactionOptions`. */
  formatUserFacingError: typeof coreFormatUserFacingError;
  redactionOptions: AgentFailureRedactionOptions; }) {
  const t = useTHook();
  const failure = useAgentFailureCardHook({ ...props, useTHook }, {});
  const formatted = useMemo(() => failure ? formatUserFacingError({ message: failure.reason,
    action: failure.hint ?? t("Review the saved work above before sending another message. Copy details and report this problem."),
    step: failure.agentId ? `assistant answer (${failure.agentId})` : "assistant answer", cause: failure.details }, redactionOptions) : null, [failure?.reason, failure?.hint, failure?.agentId, failure?.details, t, formatUserFacingError, redactionOptions]);
  if (!failure || !formatted) return null;
  return (
    <div className="jini-agent-failure jini-message-error">
      <ErrorNotice failure={formatted} t={t} className="jini-notice jini-notice-error" role="status" />
      <AgentFailureAction failure={failure} />
    </div>
  );
}

function AgentFailureAction({ failure }: { failure: NonNullable<ReturnType<typeof useAgentFailureCard>> }) {
  return failure.switchAgent ? <button type="button" onClick={failure.switchAgent}>{failure.switchLabel}</button> : null;
}
