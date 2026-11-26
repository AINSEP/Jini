import { useEffect, useRef, useState } from "react";
import type { UserFacingError } from "@jini-ai/core";
import type { useStaticPublish, StaticPublishController } from "./use-static-publish.hooks.js";
import { UNKNOWN_ERROR } from "./static-publish-actions.js";
type AdminPublishRunSnapshot = NonNullable<StaticPublishController["run"]>;

/** Same interval `use-static-export.hooks.ts` polls its own run at — see that constant's doc for
 *  why this width. Publishing additionally blocks on an external provider's own build (up to
 *  roughly a minute per `publish-site.ts`'s header), so this loop simply runs for longer, not
 *  faster or slower. */
const PUBLISH_POLL_INTERVAL_MS = 1500;

/** Same bound and same rationale as `use-static-export.hooks.ts`'s own `POLL_FAILURE_LIMIT` — how
 *  many CONSECUTIVE poll failures the loop below tolerates before giving up and surfacing
 *  {@link StaticPublishController.pollError} instead of retrying forever. */
const PUBLISH_POLL_FAILURE_LIMIT = 3;




export function useStaticPublishRun({ port, locale, hooks, deps }: Parameters<typeof useStaticPublish>[0], _optional = {}) {
  const { useFetchQuery } = hooks;
  const { publishLoadErrorMessage, describeApiError } = deps;
  const query = useFetchQuery({ key: ["deployment", "publish"], fetch: () => port.getPublishStatus() });
  const [run, setRun] = useState<AdminPublishRunSnapshot | undefined>(undefined);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishFailure, setPublishFailure] = useState<UserFacingError | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);

  // Seeds `run` from the query's first successful load, exactly once — same shape
  // `use-static-export.hooks.ts`'s own `seededRef` uses, and for the same reason (a reload mid-
  // publish, or a second tab, should show the real state rather than a blank "not started").
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || query.status === "loading" || !query.data) return;
    seededRef.current = true;
    setRun(query.data);
  }, [query.status, query.data]);

  const loadError = query.error ? publishLoadErrorMessage({ locale, error: describeApiError({ e: query.error, fallback: UNKNOWN_ERROR }) }) : null;

  // Counts CONSECUTIVE poll failures for the `PUBLISH_POLL_FAILURE_LIMIT` bound below — same ref-not-
  // state reasoning `use-static-export.hooks.ts`'s own `pollFailuresRef` documents.
  const pollFailuresRef = useRef(0);
  // Synchronous duplicate-submit guard for `publish()` — a ref, not the `publishing` state, because a
  // true double-click can fire two calls in the same synchronous tick, before React has re-rendered
  // with `publishing: true`; `publishing` (state) still exists to let the UI disable the button, but
  // the guard that actually stops a second POST from ever being sent has to be synchronous (C4 fix).
  const publishingRef = useRef(false);

  const isPublishing = run?.status === "running" && pollError === null;
  const pollInputs = useRef({ port, locale });
  pollInputs.current = { port, locale };

  return { run, setRun, publishing, setPublishing, publishError, setPublishError, publishFailure, setPublishFailure, pollError, setPollError, seededRef, loadError, pollFailuresRef, publishingRef, isPublishing, pollInputs };
}

export function useStaticPublishPolling({ state, deps }: {
  state: ReturnType<typeof useStaticPublishRun>;
  deps: Parameters<typeof useStaticPublish>[0]["deps"];
}, _optional = {}) {
  const { isPublishing, pollInputs, pollFailuresRef, setRun, setPollError } = state;
  const { setTimeout, clearTimeout, publishPollErrorMessage, describeApiError } = deps;
  // Self-scheduling poll loop, re-armed only when `isPublishing` flips true — identical shape and
  // identical reasoning to `use-static-export.hooks.ts`'s own poll effect; see that file's comment
  // for why `run`/`port` are deliberately excluded from the dependency list.
  useEffect(() => {
    if (!isPublishing) return undefined;
    const { port: pollPort, locale: pollLocale } = pollInputs.current;
    let cancelled = false;
    let timer: ReturnType<Parameters<typeof useStaticPublish>[0]["deps"]["setTimeout"]>;

    function scheduleNext() {
      timer = setTimeout(poll, PUBLISH_POLL_INTERVAL_MS);
    }
    async function poll() {
      try {
        const status = await pollPort.getPublishStatus();
        if (cancelled) return;
        pollFailuresRef.current = 0;
        setRun(status);
        if (status.status === "running") scheduleNext();
      } catch (err) {
        if (cancelled) return;
        pollFailuresRef.current += 1;
        if (pollFailuresRef.current >= PUBLISH_POLL_FAILURE_LIMIT) {
          // Bounded (C2, same shape as use-static-export.hooks.ts's own fix): give up rather than
          // retry forever. Setting `pollError` also flips `isPublishing` false on the next render,
          // which re-arms this effect's own cleanup — but `return` here (no `scheduleNext()`) is
          // what actually stops the loop; it must not depend on that later render having happened.
          setPollError(publishPollErrorMessage({ locale: pollLocale, error: describeApiError({ e: err, fallback: UNKNOWN_ERROR }) }));
          return;
        }
        scheduleNext();
      }
    }
    scheduleNext();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isPublishing]);

}
