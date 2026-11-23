import type { agentHandle as coreAgentHandle } from "@jini-ai/core/agent-handles";

import { type Translate } from '@jini-ai/core/text';
/**
 * @file The editor's "Publish at" control (2026-10-05) — props and JSX only. State lives in
 * `usePostEditor` (the value is saved with the post).
 *
 * Its "Featured image" sibling (and the `PostPublishingFields` row that held both) was removed with
 * the settings modal's Image tab (owner, 2026-10-11): the cover slot above the title
 * (`PostCoverImage.tsx`) edits the same `featuredMediaId` through the same picker hook.
 */

export interface PostPublishAtFieldProps {
  publishAtInput: string;
  setPublishAtInput: (value: string) => void;
  scheduled: boolean;
  t: Translate;
  /** Builds the agent-handle DOM props for the control; injected by the host. */
  agentHandle: typeof coreAgentHandle;
}

/** "Publish at" — the post settings modal's Publish tab. */
export function PostPublishAtField({ publishAtInput, setPublishAtInput, scheduled, t, agentHandle }: PostPublishAtFieldProps) {
  return (
    <label className="jini-post-publishing__field">
      <span className="jini-field-label">{t("Publish at")}</span>
      <input
        type="datetime-local"
        value={publishAtInput}
        onChange={(e) => setPublishAtInput(e.target.value)}
        {...agentHandle({ handle: "post-publish-at" }, {
          role: "field",
          label:
            "When this post goes live, in your local time. Leave empty to go live as soon as it is published. " +
            "A published post with a future time stays hidden until then.",
        })}
      />
      {scheduled ? <span className="jini-post-publishing__scheduled-badge">{t("Scheduled")}</span> : null}
    </label>
  );
}
