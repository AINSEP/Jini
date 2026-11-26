import { useMemo, useRef, useState } from "react";
import { buildStaticPublishConfig, publishTargetById } from "../rules.js";
import type { useStaticPublish, StaticPublishController } from "./use-static-publish.hooks.js";
import { UNKNOWN_ERROR } from "./static-publish-actions.js";
type AdminStaticPublishTargetId = StaticPublishController["target"];
type AdminStaticPublishPreview = NonNullable<StaticPublishController["preview"]>;


export function useStaticPublishForm({ port, locale, hooks, deps }: Parameters<typeof useStaticPublish>[0], _optional = {}) {
  const { useFetchQuery } = hooks;
  const { localizePublishTargets, publishLoadErrorMessage, describeApiError } = deps;
  const targetsQuery = useFetchQuery({ key: ["deployment", "publish-targets"], fetch: () => port.listPublishTargets() });
  // The host's own text in the viewer's locale, once, so every consumer (this form, the credential
  // rows built from these targets) renders it translated.
  const targets = useMemo(() => localizePublishTargets({ targets: targetsQuery.data, locale }), [targetsQuery.data, locale]);
  const targetsError = targetsQuery.error ? publishLoadErrorMessage({ locale, error: describeApiError({ e: targetsQuery.error, fallback: UNKNOWN_ERROR }) }) : null;
  const [chosenTarget, setChosenTarget] = useState<AdminStaticPublishTargetId | null>(null);
  const target = selectedPublishTargetId({ chosenTarget, targets });
  const selectedTarget = publishTargetById({ targets, id: target });
  const [valuesByTarget, setValuesByTarget] = useState<Record<AdminStaticPublishTargetId, Record<string, string>>>({});
  const configValues = valuesByTarget[target] ?? {};
  const [projectName, setProjectName] = useState("");

  const [preview, setPreview] = useState<AdminStaticPublishPreview | undefined>(undefined);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Bumped by every field edit (via `invalidatePreview` below) so `checkPreview` can tell whether
  // the fields it was called against are still the CURRENT fields once its request resolves — see
  // that function's own note (C3 fix).
  const previewGenerationRef = useRef(0);

  // Synchronous duplicate-submit guard for `checkPreview()` (2026-09-05 stale-settlement sweep, C5
  // fix) — same reasoning `publishingRef` documents for `publish()` below, PLUS a second failure mode
  // specific to `checkPreview`: with no guard, two overlapping calls share the one `previewLoading`
  // flag, so whichever call's own `finally` fires FIRST clears it while the OTHER is still in flight —
  // the Preview button (and any caller depending on `previewLoading`) would read "not loading" with a
  // request still outstanding. A ref, not `previewLoading` (state) itself: a same-tick double call
  // (or any caller reaching `checkPreview()` directly, not just through the disabled button) must see
  // the other call's claim synchronously, before either has re-rendered.
  const previewCallRef = useRef(false);

  // Every setter below clears the (now stale) preview as a side effect — see this file's header.
  function invalidatePreview() {
    previewGenerationRef.current += 1;
    setPreview(undefined);
    setPreviewError(null);
  }
  function setTarget(value: AdminStaticPublishTargetId) {
    if (publishTargetById({ targets, id: value }) === undefined) return;
    setChosenTarget(value);
    invalidatePreview();
  }
  function setConfigField({ name, value }: { name: string; value: string }, _options = {}) {
    setValuesByTarget((prev) => ({ ...prev, [target]: { ...prev[target], [name]: value } }));
    invalidatePreview();
  }

  return {
    targets, targetsError, target, selectedTarget, setTarget, configValues, setConfigField,
    projectName, setProjectName, preview, previewLoading, previewError,
    checkPreview: () => checkPreview({ selectedTarget, port, configValues, previewCallRef, previewGenerationRef, setPreviewError, setPreviewLoading, setPreview, locale, deps }),
  };
}

export async function checkPreview({ selectedTarget, port, configValues, previewCallRef, previewGenerationRef, setPreviewError, setPreviewLoading, setPreview, locale, deps }: {
  selectedTarget: StaticPublishController["selectedTarget"]; port: Parameters<typeof useStaticPublish>[0]["port"];
  configValues: StaticPublishController["configValues"]; previewCallRef: { current: boolean }; previewGenerationRef: { current: number };
  setPreviewError: (value: string | null) => void; setPreviewLoading: (value: boolean) => void;
  setPreview: (value: StaticPublishController["preview"]) => void; locale: string; deps: Parameters<typeof useStaticPublish>[0]["deps"];
}, _optional = {}) {
  const { publishPreviewErrorMessage, describeApiError } = deps;
    // A second call while the first is still in flight is a duplicate submit — ignore it here too,
    // not just via the UI's `previewLoading`-gated disabled state, so the race can't still send two
    // requests or tear down `previewLoading` out from under the call that's still running (C5 fix,
    // same "ignored outright" idiom `publish()`'s `publishingRef` uses below). Safe against a
    // same-tick double call specifically because it is synchronous: nothing yields between the read
    // and the write, so a second synchronous call always observes this call's claim.
    if (previewCallRef.current || selectedTarget === undefined) return;
    previewCallRef.current = true;
    // Captured BEFORE the request starts — if a field edit bumps `previewGenerationRef` while this
    // request is in flight, the comparison below after `await` tells us this result is now stale
    // (C3 fix: without it, a slow preview response for `acme/old` could resolve AFTER the operator
    // had already changed the field to `acme/new` and repopulate the form with the wrong target).
    const requestGeneration = previewGenerationRef.current;
    setPreviewError(null);
    setPreviewLoading(true);
    try {
      const result = await port.getPublishPreview(buildStaticPublishConfig({ target: selectedTarget, values: configValues }));
      // A field edited after this request started already invalidated the preview and moved the
      // generation forward — applying this now-stale result would repopulate the OLD fields over a
      // form the operator has since changed. Discard it silently; the edit's own `invalidatePreview()`
      // already left `preview`/`previewError` in the right (empty) state.
      if (previewGenerationRef.current !== requestGeneration) return;
      setPreview(result);
    } catch (err) {
      if (previewGenerationRef.current !== requestGeneration) return;
      setPreviewError(publishPreviewErrorMessage({ locale, error: describeApiError({ e: err, fallback: UNKNOWN_ERROR }) }));
    } finally {
      // Unconditional, unlike the two branches above: this request's own spinner must stop once ITS
      // OWN network call settles regardless of generation, or a discarded stale response would leave
      // `previewLoading` stuck true forever with nothing left in flight to ever clear it. Safe to
      // always release `previewCallRef` here too now that duplicates are refused at entry, above —
      // there is never a second, still-running call left whose own flag this could clobber.
      previewCallRef.current = false;
      setPreviewLoading(false);
    }
  }

/** A chosen target wins; the initial target follows the provider's published ordering. */
function selectedPublishTargetId({ chosenTarget, targets }: {
  chosenTarget: AdminStaticPublishTargetId | null;
  targets: Parameters<typeof publishTargetById>[0]["targets"];
}): AdminStaticPublishTargetId {
  return chosenTarget ?? targets?.[0]?.id ?? "";
}
