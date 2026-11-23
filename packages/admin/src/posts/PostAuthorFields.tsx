import { agentHandle } from "@jini-ai/core/agent-handles";

import { type Translate } from '@jini-ai/core/text';
/** Byline controls; the editor hook owns state, dirty tracking and persistence. */
export function PostAuthorFields({ author, setAuthor, showAuthor, setShowAuthor, t }: {
  author: string;
  setAuthor: (value: string) => void;
  showAuthor: boolean;
  setShowAuthor: (value: boolean) => void;
  t: Translate;
}) {
  return (
    <div className="jini-post-publishing__fields">
      <label className="jini-post-publishing__field">
        <span className="jini-field-label">{t("Author")}</span>
        <input type="text" value={author} onChange={(event) => setAuthor(event.target.value)}
          {...agentHandle({ handle: "post-author" }, { role: "field", label: "Post author display name; editable to any name" })} />
      </label>
      <label className="jini-post-publishing__field">
        <input type="checkbox" checked={showAuthor} onChange={(event) => setShowAuthor(event.target.checked)}
          {...agentHandle({ handle: "post-show-author" }, { role: "field", label: "Show post author in the byline" })} />
        <span className="jini-field-label">{t("Show post author")}</span>
      </label>
    </div>
  );
}
