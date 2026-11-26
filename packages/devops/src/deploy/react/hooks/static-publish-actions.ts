import { formatUserFacingError } from "@jini-ai/core";
import { buildStaticPublishConfig, staticPublishProjectNameToSend, type AdminPublishTargetDescriptor } from "../rules.js";
import type { useStaticPublish, StaticPublishController, StaticPublishOptions } from "./use-static-publish.hooks.js";
import type { useStaticPublishForm } from "./static-publish-form.hooks.js";
import type { useStaticPublishRun } from "./static-publish-run.hooks.js";
type AdminStaticPublishConfig = NonNullable<StaticPublishOptions["destination"]>["config"];

export const UNKNOWN_ERROR = "The publish service returned no explanation. Check publish status before trying again, and report this message if the problem continues.";

export async function publish({ options, form, state, port, locale, t, deps }: {
  options: StaticPublishOptions;
  form: ReturnType<typeof useStaticPublishForm>;
  state: ReturnType<typeof useStaticPublishRun>;
} & Pick<Parameters<typeof useStaticPublish>[0], "port" | "locale" | "t" | "deps">, _optional = {}) {
  const { selectedTarget, configValues, projectName } = form;
  const { publishingRef, seededRef, pollFailuresRef, setPollError, setPublishError, setPublishFailure, setPublishing, setRun } = state;
  const { publishTriggerErrorMessage, describeApiError, errorRedactionOptions } = deps;
    // A second call while the first is still in flight is a duplicate submit (e.g. a double-click
    // landing before React re-renders with the button disabled) — ignore it here too, not just via
    // the UI's `publishing`-gated disabled state, so the race can't still send two POSTs (C4 fix).
    // This check-then-set is safe against a same-tick double call specifically BECAUSE it is
    // synchronous: nothing yields between the read and the write below, so a second synchronous call
    // always observes this call's write.
    const request = publishRequestFor({ options, selectedTarget, configValues, projectName });
    if (publishingRef.current || request === undefined) return;
    publishingRef.current = true;
    // Local action supersedes any still-pending bootstrap read — same C1 fix and same reasoning
    // `use-static-export.hooks.ts`'s own `trigger()` documents: this write is synchronous and
    // happens-before the `await` below, so it wins the race regardless of how late the bootstrap
    // read resolves.
    seededRef.current = true;
    // A fresh publish also clears any earlier poll-failure standoff (C2) — the operator retrying via
    // this same button is exactly the recovery path a stalled `pollError` is meant to unblock.
    pollFailuresRef.current = 0;
    setPollError(null);
    setPublishError(null);
    setPublishFailure(null);
    setPublishing(true);
    try {
      const started = await port.triggerPublish({
        ...request,
        // Conditional spread, never `credentialId: options.credentialId` — an absent choice must not
        // reach the wire as an explicit `undefined` key.
        ...(options.credentialId !== undefined ? { credentialId: options.credentialId } : {}),
      });
      setRun(started);
    } catch (err) {
      const failure = formatUserFacingError({ message: publishTriggerErrorMessage({ locale, error: describeApiError({ e: err, fallback: UNKNOWN_ERROR }) }),
        action: t("Check publish status before starting another publish. Copy details and report this problem."), step: "static.publish.start", cause: err }, errorRedactionOptions);
      setPublishError(failure.message);
      setPublishFailure(failure);
    } finally {
      publishingRef.current = false;
      setPublishing(false);
    }
  }

/** The target config and project name a publish sends: a replayed destination as saved, else the
 *  form's current fields. `undefined` while the form has no target loaded yet. @complexity O(f). */
function publishRequestFor(input: {
  options: StaticPublishOptions;
  selectedTarget: AdminPublishTargetDescriptor | undefined;
  configValues: Readonly<Record<string, string>>;
  projectName: string;
}): { config: AdminStaticPublishConfig; projectName: string } | undefined {
  if (input.options.destination) return input.options.destination;
  if (input.selectedTarget === undefined) return undefined;
  return {
    config: buildStaticPublishConfig({ target: input.selectedTarget, values: input.configValues }),
    projectName: staticPublishProjectNameToSend({ target: input.selectedTarget, projectName: input.projectName }),
  };
}

