import { agentHandle } from "@jini-ai/core/agent-handles";

/**
 * @file A static publish run's terminal detail, shared by the Deployment Static Site tab and the
 * Sites Export tab's Publish list (one copy, so both read a settled run the same way).
 */

export interface PublishRunResultProps {
  readonly classes: { readonly success: string; readonly error: string };
  run: {
    status: 'idle' | 'running' | 'completed' | 'errored';
    result?: { ok: true; url: string } | { ok: false; message: string };
    error?: string;
  };
  publishedLabel: string;
  linkLabel: string;
  /** The result link's agent handle — unique per screen that shows a run. */
  linkHandle: string;
}

/** A publish run's completed/errored detail — the live URL on success, or the failure message. */
export function PublishRunResult({ run, publishedLabel, linkLabel, linkHandle, classes }: PublishRunResultProps) {
  if (run.status !== "completed" && run.status !== "errored") return null;
  // `result` can be present at EITHER terminal status — `publish-site.ts`'s own trigger route maps
  // ANY `publishStaticSite` outcome with `ok: false` (bad config, no credential, a rejected provider
  // call) to `status: "errored"`, not `"completed"`; only a route-level exception the route itself
  // never expected (no `result` at all) falls back to the bare `run.error` string. Checking `result`
  // FIRST regardless of `status` is what a naive `status === "errored" -> run.error` branch gets
  // wrong — verified live against a real triggered publish with no credential configured, which
  // settles to `status: "errored"` with a full `result.message`, not an empty `run.error`.
  if (run.result) {
    if (!run.result.ok) {
      return (
        <p className={classes.error} role="alert">
          {run.result.message}
        </p>
      );
    }
    return (
      <p className={classes.success}>
        {publishedLabel}{" "}
        <a
          href={run.result.url}
          target="_blank"
          rel="noreferrer"
          translate="no"
          {...agentHandle({ handle: linkHandle }, { role: "link", label: linkLabel })}
        >
          {run.result.url}
        </a>
      </p>
    );
  }
  if (run.error) {
    return <p className={classes.error} role="alert">{run.error}</p>;
  }
  return null;
}
