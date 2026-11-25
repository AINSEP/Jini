import type { AgentHandleOptions, AgentHandleProps } from "@jini-ai/core/agent-handles";

/**
 * @file `plan-publish-sections-2026-09-25.md` §2 S3 — markup only, matching the Dashboard's own
 * "Publish all content" `.btn-secondary` (`Dashboard.tsx`), one level down: `.btn-secondary`, not
 * `.btn-primary`, because every list page this sits on already has its own primary create action
 * (New Page, New Post, Add New, etc. — plan §1's judgment call). All state and the `requestPublish`
 * call live in `use-publish-section-button.hooks.ts`.
 */
export interface PublishSectionButtonProps<Section extends string> {
  /** Which publishable section (`PUBLISH_SECTIONS`) this button opens the dialog scoped to. */
  section: Section;
  /** Button variant class; `.btn-secondary` unless the host screen says otherwise (Themes uses
   *  `.btn-primary`, owner 2026-10-11). */
  className?: string | undefined;
  usePublishSectionButtonHook: (
    required: { section: Section },
    optional?: Record<string, never>,
  ) => { visible: boolean; label: string; onClick: () => void };
  agentHandle: (
    required: { handle: string }, optional?: AgentHandleOptions,
  ) => AgentHandleProps;
  agentLabel: string;
}

export function PublishSectionButton<Section extends string>({ section, className = "btn-secondary", usePublishSectionButtonHook, agentHandle, agentLabel }: PublishSectionButtonProps<Section>) {
  const { visible, label, onClick } = usePublishSectionButtonHook({ section });
  if (!visible) return null;
  return (
    <button
      type="button"
      className={className}
      onClick={onClick}
      {...agentHandle({ handle: `publish-section-${section}` }, {
        role: "button",
        label: agentLabel,
      })}
    >
      {label}
    </button>
  );
}
